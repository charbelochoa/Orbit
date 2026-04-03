/**
 * Orbit Plan Mode Engine — Sprint 8
 *
 * When plan mode is active, tool calls are intercepted and logged instead of
 * executed. The user can then review the plan and execute it explicitly.
 */

import { createLogger } from "../infra/logger.js";

const log = createLogger("PlanMode");

// ── Types ─────────────────────────────────────────────────────────────────────

export interface PlannedStep {
    index:       number;
    toolName:    string;
    args:        Record<string, unknown>;
    description: string;
    timestamp:   number;
    executed:    boolean;
    result?:     string;
}

// ── State ─────────────────────────────────────────────────────────────────────

let _active = false;
const _steps: PlannedStep[] = [];

// ── Public API ────────────────────────────────────────────────────────────────

export function isPlanMode(): boolean {
    return _active;
}

export function enterPlanMode(): void {
    _active = true;
    log.info("Plan mode activado");
}

export function exitPlanMode(): void {
    _active = false;
    log.info("Plan mode desactivado");
}

export function togglePlanMode(): boolean {
    _active = !_active;
    log.info(`Plan mode ${_active ? "activado" : "desactivado"}`);
    return _active;
}

/**
 * Record a tool call as a planned step (call only when isPlanMode() === true).
 * Returns the index of the newly added step.
 */
export function logPlannedStep(
    toolName: string,
    args: Record<string, unknown>,
    description?: string,
): number {
    const index = _steps.length + 1;
    const desc  = description || _buildDescription(toolName, args);
    _steps.push({
        index,
        toolName,
        args,
        description: desc,
        timestamp: Date.now(),
        executed: false,
    });
    log.debug(`Paso ${index} registrado: ${toolName}`);
    return index;
}

export function getPlan(): PlannedStep[] {
    return [..._steps];
}

export function clearPlan(): void {
    _steps.length = 0;
    log.info("Plan limpiado");
}

/**
 * Execute all pending (non-executed) planned steps in order.
 * Returns an array of {index, toolName, result} summaries.
 */
export async function executePlan(): Promise<Array<{ index: number; toolName: string; result: string }>> {
    // Import here to avoid circular dependency at module load time
    const { executeTool } = await import("../actions/index.js");

    const results: Array<{ index: number; toolName: string; result: string }> = [];

    for (const step of _steps) {
        if (step.executed) continue;

        try {
            // Temporarily disable plan mode so the step actually runs
            _active = false;
            const outcome = await executeTool(step.toolName, step.args as Record<string, any>);
            _active = true;

            step.executed = true;
            step.result   = typeof outcome === "string" ? outcome : JSON.stringify(outcome);
        } catch (err) {
            _active = true;
            step.result = `Error: ${(err as Error).message}`;
        }

        results.push({ index: step.index, toolName: step.toolName, result: step.result! });
    }

    return results;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function _buildDescription(toolName: string, args: Record<string, unknown>): string {
    const pairs = Object.entries(args)
        .slice(0, 3)
        .map(([k, v]) => `${k}=${String(v).slice(0, 40)}`);
    return pairs.length ? `${toolName}(${pairs.join(", ")})` : toolName;
}

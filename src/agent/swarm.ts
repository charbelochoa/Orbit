/**
 * Orbit Swarm Orchestrator — Sprint 5
 * Executes multiple agent goals in parallel using SubagentRegistry + lanes.
 *
 * A "swarm" is a named group of tasks that run concurrently.
 * The orchestrator:
 *   1. Spawns N subagents in parallel (respecting lane limits)
 *   2. Aggregates results/errors as each finishes
 *   3. Broadcasts real-time progress to the UI via WebSocket
 *   4. Returns a structured SwarmResult when all done (or on timeout)
 *
 * Example use:
 *   const result = await runSwarm("audit", [
 *     { id: "security",    goal: "Analiza el código buscando vulnerabilidades OWASP" },
 *     { id: "performance", goal: "Revisa los cuellos de botella de rendimiento" },
 *     { id: "tests",       goal: "Comprueba la cobertura de tests y sugiere los que faltan" },
 *     { id: "docs",        goal: "Evalúa si la documentación está actualizada" },
 *   ]);
 */

import { subagentRegistry } from "./subagent-registry.js";
import { createLogger } from "../infra/logger.js";
import { broadcast } from "../gateway/server.js";

const log = createLogger("swarm");

// ── Types ─────────────────────────────────────────────────────────────────────

export interface SwarmTask {
    /** Unique ID within the swarm (e.g. "security", "tests") */
    id:       string;
    /** The goal to pass to the subagent */
    goal:     string;
    /** Optional context text injected as prefix into the goal */
    context?: string;
    /** Timeout for this specific task in ms (overrides swarm default) */
    timeoutMs?: number;
}

export interface SwarmTaskResult {
    id:        string;
    goal:      string;
    status:    "done" | "failed" | "cancelled" | "timeout";
    result?:   string;
    error?:    string;
    durationMs: number;
}

export interface SwarmResult {
    swarmId:     string;
    name:        string;
    totalTasks:  number;
    succeeded:   number;
    failed:      number;
    durationMs:  number;
    tasks:       SwarmTaskResult[];
    /** Merged summary of all results (for the calling agent to use) */
    summary:     string;
}

export interface SwarmOptions {
    /** Human name for the swarm (displayed in UI) */
    name?:         string;
    /** Parent session ID for subagent scoping */
    sessionId?:    string;
    /** Global timeout for the entire swarm in ms (default: 5 min) */
    timeoutMs?:    number;
    /** Per-task default timeout in ms (default: 2 min) */
    taskTimeoutMs?: number;
    /** Max concurrent tasks (default: 4 — respects global lane limits) */
    concurrency?:  number;
}

// ── Swarm Registry (in-memory, for status queries) ───────────────────────────

const activeSwarms = new Map<string, SwarmResult & { startedAt: number; done: boolean }>();

export function getActiveSwarms(): Array<SwarmResult & { startedAt: number; done: boolean }> {
    return Array.from(activeSwarms.values());
}

// ── Main API ──────────────────────────────────────────────────────────────────

/**
 * Run a swarm of parallel tasks and return aggregated results.
 */
export async function runSwarm(
    tasks:   SwarmTask[],
    options: SwarmOptions = {},
): Promise<SwarmResult> {
    const swarmId     = `swarm_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`;
    const name        = options.name ?? `Swarm(${tasks.length})`;
    const sessionId   = options.sessionId ?? "swarm_parent";
    const swarmTimeout = options.timeoutMs ?? 5 * 60_000;
    const taskTimeout  = options.taskTimeoutMs ?? 2 * 60_000;
    const concurrency  = options.concurrency ?? 4;
    const startedAt    = Date.now();

    log.info(`Swarm '${name}' [${swarmId}]: lanzando ${tasks.length} tareas (concurrency: ${concurrency})`);

    broadcast({
        type:     "swarm_started",
        swarmId,
        name,
        total:    tasks.length,
        tasks:    tasks.map(t => ({ id: t.id, goal: t.goal.slice(0, 80) })),
    });

    // ── Run tasks with bounded concurrency ────────────────────────────────────
    const taskResults: SwarmTaskResult[] = [];
    const pending = [...tasks];
    const inFlight = new Set<Promise<void>>();

    const runTask = async (task: SwarmTask): Promise<void> => {
        const taskStart = Date.now();

        // Build full goal (optionally prefixed with context)
        const fullGoal = task.context
            ? `Context:\n${task.context}\n\nTarea:\n${task.goal}`
            : task.goal;

        broadcast({ type: "swarm_task_start", swarmId, taskId: task.id, goal: task.goal.slice(0, 80) });

        let subId: string;
        try {
            subId = await subagentRegistry.spawn({
                goal:            fullGoal,
                parentSessionId: sessionId,
                timeoutMs:       task.timeoutMs ?? taskTimeout,
            });
        } catch (e: any) {
            taskResults.push({
                id: task.id, goal: task.goal,
                status: "failed", error: `spawn failed: ${e.message}`,
                durationMs: Date.now() - taskStart,
            });
            broadcast({ type: "swarm_task_done", swarmId, taskId: task.id, status: "failed" });
            return;
        }

        try {
            const result = await subagentRegistry.wait(subId, task.timeoutMs ?? taskTimeout);
            taskResults.push({
                id: task.id, goal: task.goal,
                status: "done", result,
                durationMs: Date.now() - taskStart,
            });
            broadcast({ type: "swarm_task_done", swarmId, taskId: task.id, status: "done" });
            log.debug(`Swarm task '${task.id}' completada en ${Date.now() - taskStart}ms`);
        } catch (e: any) {
            const isTimeout = e.message?.includes("timeout");
            taskResults.push({
                id: task.id, goal: task.goal,
                status: isTimeout ? "timeout" : "failed",
                error: e.message,
                durationMs: Date.now() - taskStart,
            });
            broadcast({
                type: "swarm_task_done", swarmId, taskId: task.id,
                status: isTimeout ? "timeout" : "failed",
            });
        }
    };

    // Bounded concurrency loop + global swarm timeout guard
    const swarmDeadline = Date.now() + swarmTimeout;

    while ((pending.length > 0 || inFlight.size > 0) && Date.now() < swarmDeadline) {
        // Fill up to concurrency limit
        while (inFlight.size < concurrency && pending.length > 0) {
            const task = pending.shift()!;
            const p = runTask(task).then(() => { inFlight.delete(p); });
            inFlight.add(p);
        }

        if (inFlight.size > 0) {
            // Wait for any one to complete
            await Promise.race(inFlight);
        }
    }

    // If global timeout hit, mark remaining pending tasks as timeout
    for (const remainingTask of pending) {
        taskResults.push({
            id: remainingTask.id, goal: remainingTask.goal,
            status: "timeout", error: "Swarm global timeout exceeded",
            durationMs: 0,
        });
    }

    // ── Build result ──────────────────────────────────────────────────────────
    const succeeded = taskResults.filter(r => r.status === "done").length;
    const failed    = taskResults.filter(r => r.status !== "done").length;
    const durationMs = Date.now() - startedAt;

    const summary = _buildSummary(name, taskResults);

    const swarmResult: SwarmResult = {
        swarmId, name,
        totalTasks: tasks.length,
        succeeded, failed,
        durationMs,
        tasks: taskResults,
        summary,
    };

    activeSwarms.set(swarmId, { ...swarmResult, startedAt, done: true });

    broadcast({
        type: "swarm_done",
        swarmId, name,
        succeeded, failed, durationMs,
        summary: summary.slice(0, 500),
    });

    log.info(`Swarm '${name}' completado: ${succeeded}/${tasks.length} OK en ${(durationMs / 1000).toFixed(1)}s`);

    return swarmResult;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function _buildSummary(swarmName: string, results: SwarmTaskResult[]): string {
    const lines: string[] = [`# ${swarmName} — Resultados del Swarm\n`];

    for (const r of results) {
        const icon = r.status === "done" ? "✅" : r.status === "timeout" ? "⏱️" : "❌";
        lines.push(`## ${icon} ${r.id} (${(r.durationMs / 1000).toFixed(1)}s)`);
        if (r.result) {
            // Take first 600 chars of result
            lines.push(r.result.slice(0, 600));
            if (r.result.length > 600) lines.push("*[truncado]*");
        } else if (r.error) {
            lines.push(`Error: ${r.error}`);
        }
        lines.push("");
    }

    return lines.join("\n");
}

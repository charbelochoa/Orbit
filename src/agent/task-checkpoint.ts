import type { PlanStep } from "./planner.js";
import { toolRegistry } from "../core/registry.js";
import { hasToolHooks } from "../hooks/runner.js";

export type TaskStepResult = { success: boolean; output: string; abort?: boolean };

export type TaskStepState = { state: "running"; replaySafe?: boolean } | ({ state: "settled" } & TaskStepResult);

const NO_EFFECT_TOOL_NAMES = new Set(["glob_search", "grep_search", "todo_read", "web_search", "weather_report"]);

export function toolMayHaveSideEffect(toolName: string): boolean {
    const tool = toolRegistry.get(toolName);
    return !NO_EFFECT_TOOL_NAMES.has(toolName) || !tool || Boolean(tool.capabilities.destructive) ||
        Boolean(tool.capabilities.requiresUI) || hasToolHooks(toolName);
}

export interface TaskCheckpoint {
    steps: PlanStep[];
    states: Partial<Record<number, TaskStepState>>;
}

export const PLANNING_CHECKPOINT: TaskCheckpoint = { steps: [], states: {} };

export function summarizeTaskSteps(checkpoint?: TaskCheckpoint) {
    return checkpoint?.steps.map(({ step, tool, description }) => {
        const entry = checkpoint.states[step];
        return {
            step, tool, description,
            state: entry?.state === "settled" ? (entry.success ? "done" : "error") : entry?.state,
            error: entry?.state === "settled" && !entry.success ? entry.output.slice(0, 1000) : undefined,
            replaySafe: entry?.state === "running" && entry.replaySafe === true && !toolMayHaveSideEffect(tool),
        };
    }) ?? [];
}

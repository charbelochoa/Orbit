import type { PlanStep } from "./planner.js";

export type TaskStepResult = { success: boolean; output: string; abort?: boolean };

export type TaskStepState = { state: "running" } | ({ state: "settled" } & TaskStepResult);

export interface TaskCheckpoint {
    steps: PlanStep[];
    states: Partial<Record<number, TaskStepState>>;
}

export function summarizeTaskSteps(checkpoint?: TaskCheckpoint) {
    return checkpoint?.steps.map(({ step, tool, description }) => {
        const entry = checkpoint.states[step];
        return {
            step, tool, description,
            state: entry?.state === "settled" ? (entry.success ? "done" : "error") : entry?.state,
            error: entry?.state === "settled" && !entry.success ? entry.output.slice(0, 1000) : undefined,
        };
    }) ?? [];
}

import type { PlanStep } from "./planner.js";

export type TaskStepResult = { success: boolean; output: string; abort?: boolean };

export type TaskStepState = { state: "running" } | ({ state: "settled" } & TaskStepResult);

export interface TaskCheckpoint {
    steps: PlanStep[];
    states: Partial<Record<number, TaskStepState>>;
}

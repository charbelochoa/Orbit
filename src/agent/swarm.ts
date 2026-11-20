import { randomUUID } from "node:crypto";
import { subagentRegistry } from "./subagent-registry.js";
import { broadcast } from "../gateway/server.js";

export interface SwarmTask {
    id: string;
    goal: string;
    context?: string;
    timeoutMs?: number;
}

type TaskOutcome = "done" | "failed" | "cancelled" | "timeout";

export interface SwarmTaskResult {
    id: string;
    goal: string;
    status: TaskOutcome;
    result?: string;
    error?: string;
    durationMs: number;
}

export interface SwarmResult {
    swarmId: string;
    name: string;
    totalTasks: number;
    succeeded: number;
    failed: number;
    durationMs: number;
    tasks: SwarmTaskResult[];
    summary: string;
}

interface SwarmOptions {
    name?: string;
    sessionId?: string;
    timeoutMs?: number;
    taskTimeoutMs?: number;
    concurrency?: number;
    signal?: AbortSignal;
}

interface SwarmState {
    id: string;
    name: string;
    status: "running" | TaskOutcome;
    createdAt: string;
    steps: Array<{ step: number; id: string; description: string; state: "pending" | "running" | TaskOutcome; error?: string }>;
    summary?: string;
    controller: AbortController;
}

const swarms = new Map<string, SwarmState>();

export function listSwarms() {
    return Array.from(swarms.values(), ({ controller, ...swarm }) => swarm);
}

export function getSwarmSummary(id: string): string | undefined {
    return swarms.get(id)?.summary;
}

export function cancelSwarm(id: string): boolean {
    const swarm = swarms.get(id);
    if (!swarm || swarm.status !== "running" || swarm.controller.signal.aborted) return false;
    swarm.controller.abort(new Error("Grupo cancelado por el usuario."));
    return true;
}

export function stopSwarms(): void {
    for (const { id } of swarms.values()) cancelSwarm(id);
}

function abortOutcome(signal: AbortSignal): "timeout" | "cancelled" {
    return signal.reason?.name === "TimeoutError" ? "timeout" : "cancelled";
}

function abortMessage(status: "timeout" | "cancelled"): string {
    return status === "timeout" ? "Se agotó el plazo del grupo." : "Se canceló el grupo de subagentes.";
}

export async function runSwarm(tasks: SwarmTask[], options: SwarmOptions = {}): Promise<SwarmResult> {
    options.signal?.throwIfAborted();
    if (!Array.isArray(tasks) || !tasks.length || tasks.length > 32 || tasks.some(task =>
        !task || typeof task.id !== "string" || !/^[\w.-]{1,80}$/.test(task.id) ||
        typeof task.goal !== "string" || !task.goal.trim() || task.goal.length > 32_000,
    ) || new Set(tasks.map(task => task.id)).size !== tasks.length) {
        throw new Error("Indica entre 1 y 32 subtareas con identificadores únicos y objetivos válidos.");
    }
    const concurrency = options.concurrency ?? 4;
    if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 6) {
        throw new Error("Indica entre 1 y 6 subagentes en paralelo.");
    }
    const timeoutMs = options.timeoutMs ?? 300_000;
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 3_600_000) {
        throw new Error("El tiempo límite del grupo debe estar entre 1 y 3 600 000 ms.");
    }

    const controller = new AbortController();
    const signals = [controller.signal, AbortSignal.timeout(timeoutMs)];
    if (options.signal) signals.push(options.signal);
    const signal = AbortSignal.any(signals);
    const swarmId = `swarm_${randomUUID()}`;
    const name = options.name?.trim().slice(0, 120) || `Grupo de ${tasks.length} subtareas`;
    const startedAt = Date.now();
    const state: SwarmState = {
        id: swarmId, name, status: "running", controller,
        createdAt: new Date(startedAt).toISOString(),
        steps: tasks.map((task, index) => ({ step: index + 1, id: task.id, description: task.goal.slice(0, 160), state: "pending" })),
    };
    swarms.set(swarmId, state);
    if (swarms.size > 40) {
        const expired = [...swarms].find(([, swarm]) => swarm.status !== "running");
        if (expired) swarms.delete(expired[0]);
    }
    broadcast({ type: "swarm_started", swarmId, name, total: tasks.length, steps: state.steps });

    const results: Array<SwarmTaskResult | undefined> = new Array(tasks.length);
    let cursor = 0;
    const worker = async () => {
        while (!signal.aborted && cursor < tasks.length) {
            const index = cursor++;
            const task = tasks[index];
            const start = Date.now();
            state.steps[index].state = "running";
            broadcast({ type: "swarm_task_start", swarmId, taskId: task.id, step: index + 1 });
            let id: string | undefined;
            let outcome: SwarmTaskResult;
            try {
                id = subagentRegistry.spawn({
                    goal: task.goal, context: task.context, swarmId,
                    parentSessionId: options.sessionId ?? swarmId,
                    timeoutMs: task.timeoutMs ?? options.taskTimeoutMs,
                }, signal);
                const settled = await subagentRegistry.wait(id, signal);
                if (settled.status === "pending" || settled.status === "running") throw new Error("El subagente sigue activo.");
                outcome = { id: task.id, goal: task.goal, status: settled.status, result: settled.result, error: settled.error, durationMs: Date.now() - start };
            } catch (error) {
                const settled = id ? subagentRegistry.get(id) : undefined;
                const status = settled?.status;
                const terminal = status && status !== "pending" && status !== "running" ? status : undefined;
                const interrupted = signal.aborted ? abortOutcome(signal) : undefined;
                outcome = {
                    id: task.id, goal: task.goal,
                    status: terminal ?? interrupted ?? "failed",
                    result: settled?.result,
                    error: terminal ? settled?.error : interrupted ? abortMessage(interrupted) : error instanceof Error ? error.message : String(error),
                    durationMs: Date.now() - start,
                };
            }
            results[index] = outcome;
            Object.assign(state.steps[index], { state: outcome.status, error: outcome.error?.slice(0, 1000) });
            broadcast({ type: "swarm_task_done", swarmId, taskId: task.id, step: index + 1, status: outcome.status, error: outcome.error?.slice(0, 1000) });
        }
    };
    await Promise.all(Array.from({ length: Math.min(concurrency, tasks.length) }, () => worker()));

    const taskResults = tasks.map((task, index): SwarmTaskResult => {
        const result = results[index];
        if (result) return result;
        const status = abortOutcome(signal);
        const error = abortMessage(status);
        Object.assign(state.steps[index], { state: status, error });
        return { id: task.id, goal: task.goal, status, error, durationMs: 0 };
    });
    const succeeded = taskResults.filter(result => result.status === "done").length;
    const failed = tasks.length - succeeded;
    const durationMs = Date.now() - startedAt;
    const summary = [
        `${name} · ${succeeded} de ${tasks.length} subtareas completadas`,
        ...taskResults.map(result => `${result.id} [${result.status}]\n${(result.result || result.error || "").slice(0, 700)}`),
    ].join("\n\n");
    state.status = !failed ? "done" : signal.aborted ? abortOutcome(signal) : "failed";
    state.summary = summary;
    broadcast({ type: "swarm_done", swarmId, name, succeeded, failed, durationMs, summary: summary.slice(0, 1000), status: state.status, steps: state.steps });
    return { swarmId, name, totalTasks: tasks.length, succeeded, failed, durationMs, tasks: taskResults, summary };
}

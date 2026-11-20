import { randomUUID } from "node:crypto";
import { AgentExecutor } from "./executor.js";
import { createLogger } from "../infra/logger.js";
import { broadcast } from "../gateway/server.js";
import { withWorkspace, workspaceRoot } from "../core/workspace.js";
import { TaskStore } from "./task-store.js";
import { PLANNING_CHECKPOINT, summarizeTaskSteps, type TaskCheckpoint } from "./task-checkpoint.js";
import { providerRegistry } from "../providers/registry.js";
import { withProviderSelection, type ProviderSelection } from "../providers/selection.js";
import { withConfigSnapshot } from "../config/config.js";

const log = createLogger("TaskQueue");

export enum TaskPriority {
    LOW = 1,
    NORMAL = 2,
    HIGH = 3,
}

interface QueueEntry {
    id: string;
    priority: TaskPriority;
    enqueuedAt: number;
    sequence: number;
}

const PRIORITY_HEAD_START_MS = 15_000;
const SHUTDOWN_GRACE_MS = 1_500;

function compareQueueEntries(left: QueueEntry, right: QueueEntry): number {
    return (
        left.enqueuedAt -
        right.enqueuedAt +
        (right.priority - left.priority) * PRIORITY_HEAD_START_MS || left.sequence - right.sequence
    );
}

export interface Task {
    id: string;
    goal: string;
    workspace: string;
    providerSelection?: ProviderSelection;
    dependsOn?: string;
    priority: TaskPriority;
    status: "pending" | "running" | "paused" | "interrupted" | "done" | "failed" | "cancelled";
    createdAt: Date;
    startedAt?: Date;
    endedAt?: Date;
    result?: string;
    error?: string;
    checkpoint?: TaskCheckpoint;
    output: string[];            // streaming output lines
    executor?: AgentExecutor;
    speak?: (msg: string) => void;
}

class TaskQueue {
    private tasks = new Map<string, Task>();
    private pending: QueueEntry[] = [];
    private nextSequence = 0;
    private readonly active = new Map<Task, Promise<void>>();
    private closing = false;
    private maxConcurrent = 3;
    private readonly store = new TaskStore();
    private static instance: TaskQueue;

    static getInstance(): TaskQueue {
        if (!TaskQueue.instance) TaskQueue.instance = new TaskQueue();
        return TaskQueue.instance;
    }

    private constructor() {
        for (const task of this.store.recover()) {
            this.tasks.set(task.id, task);
            if (task.status === "pending") this.enqueue(task);
        }
    }

    start(): void {
        this.processNext();
    }

    async stop(): Promise<void> {
        if (this.closing) return;
        this.closing = true;
        const reason = new Error("Orbit se está cerrando. Puedes continuar esta tarea al volver a abrirlo.");
        for (const task of this.active.keys()) task.executor?.suspend(reason);

        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
            await Promise.race([
                Promise.allSettled(this.active.values()),
                new Promise<void>(resolve => { timer = setTimeout(resolve, SHUTDOWN_GRACE_MS); }),
            ]);
        } finally {
            clearTimeout(timer);
        }

        for (const task of this.active.keys()) {
            task.executor?.cancel(reason);
            try {
                this.markStopped(task);
            } catch (error) {
                log.error("Orbit no pudo persistir el cierre de la tarea.", error);
            }
        }
    }

    /**
     * Submit a new task. Returns task ID immediately.
     */
    submit(goal: string, priority: TaskPriority = TaskPriority.NORMAL, speak?: (msg: string) => void): string {
        return this.submitBatch([goal], priority, speak)[0];
    }

    submitBatch(goals: string[], priority: TaskPriority = TaskPriority.NORMAL, speak?: (msg: string) => void): string[] {
        if (!goals.length || goals.length > 32 || goals.some(goal => typeof goal !== "string" || !goal.trim() || goal.length > 32_000)) {
            throw new Error("Indica entre 1 y 32 objetivos de hasta 32 000 caracteres cada uno.");
        }
        const workspace = workspaceRoot();
        const providerSelection = providerRegistry.captureSelection();
        const ids = goals.map(() => `task_${randomUUID()}`);
        const createdAt = new Date();
        const tasks: Task[] = goals.map((goal, index) => ({
            id: ids[index], goal: goal.trim(), workspace, providerSelection, priority, status: "pending",
            createdAt, output: [], speak, dependsOn: ids[index - 1],
        }));
        this.store.saveBatch(tasks);
        for (const task of tasks) {
            this.tasks.set(task.id, task);
            this.enqueue(task);
            broadcast({ type: "task_created", id: task.id, goal: task.goal, provider: providerSelection?.providerId, model: providerSelection?.model });
        }

        this.processNext();
        return ids;
    }

    private enqueue(task: Task): void {
        const entry = {
            id: task.id,
            priority: task.priority,
            enqueuedAt: performance.now() - Math.max(0, Date.now() - task.createdAt.getTime()),
            sequence: this.nextSequence++,
        };
        const insertIdx = this.pending.findIndex(queued => compareQueueEntries(entry, queued) < 0);
        if (insertIdx === -1) this.pending.push(entry);
        else this.pending.splice(insertIdx, 0, entry);
    }

    private processNext(): void {
        while (!this.closing && this.active.size < this.maxConcurrent && this.pending.length > 0) {
            const index = this.pending.findIndex(({ id }) => {
                const dependency = this.tasks.get(id)?.dependsOn;
                const previous = dependency && this.tasks.get(dependency);
                return !previous || ["done", "failed", "cancelled"].includes(previous.status);
            });
            if (index < 0) return;
            const [{ id }] = this.pending.splice(index, 1);
            const task = this.tasks.get(id);
            if (!task || task.status !== "pending") continue;

            try {
                if (task.dependsOn && this.tasks.get(task.dependsOn)?.status !== "done") {
                    const error = "No se completó la tarea anterior de este flujo.";
                    this.update(task, { status: "failed", endedAt: new Date(), error });
                    broadcast({ type: "task_failed", id, error });
                    continue;
                }
                this.update(task, {
                    status: "running", startedAt: new Date(), checkpoint: task.checkpoint ?? PLANNING_CHECKPOINT,
                });
            } catch (error) {
                this.enqueue(task);
                log.error("Orbit no pudo persistir el inicio de la tarea.", error);
                return;
            }
            task.executor = new AgentExecutor(id);
            const run = Promise.resolve().then(() => withWorkspace(task.workspace, () =>
                withConfigSnapshot(() => withProviderSelection(task.providerSelection, () => this._run(task))),
            )).catch(error => {
                log.error("Orbit no pudo guardar el estado de la tarea.", error);
            }).finally(() => {
                this.active.delete(task);
                this.processNext();
            });
            this.active.set(task, run);

            log.info(`Ejecutando tarea: ${id}`);
            broadcast({ type: "task_started", id });

            if (task.speak) task.speak(`Comenzando tarea: ${task.goal.slice(0, 50)}...`);
        }
    }

    private async _run(task: Task): Promise<void> {
        try {
            const result = await task.executor!.executeGoal(task.goal, (msg: string) => {
                if (task.status !== "running" && task.status !== "paused") return;
                this.update(task, { output: [...task.output.slice(-99), msg.slice(0, 8000)] });
                if (task.speak) task.speak(msg);
            }, {
                checkpoint: task.checkpoint,
                save: checkpoint => this.update(task, { checkpoint }),
            });

            if (task.status !== "running" && task.status !== "paused") return;
            this.update(task, { status: "done", result, endedAt: new Date() });
            log.info(`Tarea completada: ${task.id}`);
            broadcast({ type: "task_complete", taskId: task.id, success: true, summary: result });
            broadcast({ type: "task_done", id: task.id, result: result?.slice(0, 200) });
        } catch (e) {
            if (task.status === "cancelled") return;
            if (this.closing) {
                this.markStopped(task);
                return;
            }
            const error = e instanceof Error ? e.message : String(e);
            const interrupted = Object.values(task.checkpoint?.states ?? {}).some(entry => entry?.state === "running");
            this.update(task, { status: interrupted ? "interrupted" : "failed", error, endedAt: new Date() });
            log.error(`Ejecución de tarea detenida: ${task.id}`, error);
            broadcast({ type: interrupted ? "task_interrupted" : "task_failed", id: task.id, error });
        } finally {
            task.executor = undefined;
        }
    }

    private markStopped(task: Task): void {
        if (task.status !== "running" && task.status !== "paused") return;
        if (task.checkpoint?.steps.length) {
            const error = "Orbit se cerró durante la tarea. Puedes continuar desde el progreso guardado.";
            this.update(task, { status: "interrupted", error, endedAt: new Date() });
            broadcast({ type: "task_interrupted", id: task.id, error });
        } else {
            this.update(task, { status: "pending", startedAt: undefined });
        }
    }

    private update(task: Task, changes: Partial<Task>): void {
        this.store.save({ ...task, ...changes });
        Object.assign(task, changes);
    }

    /**
     * Pause a running task (blocks between executor waves).
     */
    pause(id: string): boolean {
        const task = this.tasks.get(id);
        if (!task || task.status !== "running" || !task.executor) return false;
        this.update(task, { status: "paused" });
        task.executor.pause();
        log.info(`Tarea pausada: ${id}`);
        broadcast({ type: "task_paused", id });
        return true;
    }

    /**
     * Resume a paused task.
     */
    resume(id: string): boolean {
        const task = this.tasks.get(id);
        if (!task || task.status !== "paused" || !task.executor) return false;
        this.update(task, { status: "running" });
        task.executor.resume();
        log.info(`Tarea reanudada: ${id}`);
        broadcast({ type: "task_resumed", id });
        return true;
    }

    continueTask(id: string, retryInterrupted = false): "queued" | "needs_confirmation" | "unavailable" {
        if (this.closing) return "unavailable";
        const task = this.tasks.get(id);
        const saved = task?.checkpoint;
        if (!task || task.status !== "interrupted" || !saved) return "unavailable";
        const states = Object.entries(saved.states);
        if (!retryInterrupted && states.some(([, entry]) => entry?.state === "running")) {
            return "needs_confirmation";
        }
        const checkpoint: TaskCheckpoint = {
            steps: saved.steps,
            states: Object.fromEntries(states.filter(([, entry]) => entry?.state === "settled")),
        };
        this.update(task, { checkpoint, status: "pending", endedAt: undefined, error: undefined });
        this.enqueue(task);
        broadcast({ type: "task_requeued", id, steps: summarizeTaskSteps(checkpoint) });
        this.processNext();
        return "queued";
    }

    /**
     * Cancel a running or pending task.
     */
    cancel(id: string): boolean {
        const task = this.tasks.get(id);
        if (!task) return false;

        if (task.status === "pending" || task.status === "interrupted") {
            this.update(task, { status: "cancelled", endedAt: new Date() });
            this.pending = this.pending.filter(entry => entry.id !== id);
            log.info(`Tarea cancelada (pendiente): ${id}`);
            broadcast({ type: "task_cancelled", id });
            this.processNext();
            return true;
        }

        if ((task.status === "running" || task.status === "paused") && task.executor) {
            this.update(task, { status: "cancelled", endedAt: new Date() });
            task.executor.cancel();
            log.info(`Tarea cancelada (en ejecución): ${id}`);
            broadcast({ type: "task_cancelled", id });
            return true;
        }

        return false;
    }

    /**
     * Get a task by ID.
     */
    get(id: string): Task | undefined {
        return this.tasks.get(id);
    }

    /**
     * Get task status summary.
     */
    status(id: string) {
        const task = this.tasks.get(id);
        if (!task) return undefined;
        return {
            id: task.id,
            status: task.status,
            goal: task.goal,
            provider: task.providerSelection?.providerId,
            model: task.providerSelection?.model,
            output_lines: task.output.length,
            result: task.result?.slice(0, 500),
            error: task.error,
        };
    }

    /**
     * Get streaming output of a task.
     */
    output(id: string, fromLine = 0): string[] {
        const task = this.tasks.get(id);
        if (!task) return [];
        return task.output.slice(fromLine);
    }

    /**
     * List all tasks.
     */
    listAll(includeSteps = false) {
        return Array.from(this.tasks.values()).map(t => ({
            id: t.id,
            goal: t.goal.slice(0, 80),
            status: t.status,
            provider: t.providerSelection?.providerId,
            model: t.providerSelection?.model,
            priority: TaskPriority[t.priority],
            createdAt: t.createdAt.toISOString(),
            result: t.result?.slice(0, 1000),
            error: t.error?.slice(0, 1000),
            steps: includeSteps ? summarizeTaskSteps(t.checkpoint) : undefined,
        }));
    }

    /**
     * Prune completed/failed/cancelled tasks older than maxAgeMs.
     */
    prune(maxAgeMs = 30 * 60_000): void {
        const now = Date.now();
        const prerequisites = new Set(this.pending.map(entry => this.tasks.get(entry.id)?.dependsOn));
        for (const [id, task] of this.tasks.entries()) {
            const terminal = ["done", "failed", "cancelled"].includes(task.status);
            const age = task.endedAt ? now - task.endedAt.getTime() : 0;
            if (terminal && age > maxAgeMs && !prerequisites.has(id)) {
                this.store.delete(id);
                this.tasks.delete(id);
            }
        }
    }
}

export const getQueue = () => TaskQueue.getInstance();

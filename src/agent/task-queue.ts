import { AgentExecutor } from "./executor.js";
import { createLogger } from "../infra/logger.js";
import { broadcast } from "../gateway/server.js";

const log = createLogger("TaskQueue");

export enum TaskPriority {
    LOW = 1,
    NORMAL = 2,
    HIGH = 3,
}

export interface Task {
    id: string;
    goal: string;
    priority: TaskPriority;
    status: "pending" | "running" | "done" | "failed" | "cancelled";
    createdAt: Date;
    startedAt?: Date;
    endedAt?: Date;
    result?: string;
    error?: string;
    output: string[];            // streaming output lines
    executor?: AgentExecutor;
    speak?: (msg: string) => void;
}

class TaskQueue {
    private tasks = new Map<string, Task>();
    private pending: string[] = [];
    private runningCount = 0;
    private maxConcurrent = 3;
    private static instance: TaskQueue;

    static getInstance(): TaskQueue {
        if (!TaskQueue.instance) TaskQueue.instance = new TaskQueue();
        return TaskQueue.instance;
    }

    /**
     * Submit a new task. Returns task ID immediately.
     */
    submit(goal: string, priority: TaskPriority = TaskPriority.NORMAL, speak?: (msg: string) => void): string {
        const id = `task_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
        const task: Task = {
            id, goal, priority,
            status: "pending",
            createdAt: new Date(),
            output: [],
            speak,
        };
        this.tasks.set(id, task);

        // Insert into pending list sorted by priority (highest first)
        const insertIdx = this.pending.findIndex(pid => {
            const t = this.tasks.get(pid);
            return t ? t.priority < priority : false;
        });
        if (insertIdx === -1) this.pending.push(id);
        else this.pending.splice(insertIdx, 0, id);

        log.info(`Tarea '${id}' creada (prioridad: ${TaskPriority[priority]}): ${goal.slice(0, 60)}`);
        broadcast({ type: "task_created", id, goal });

        this.processNext();
        return id;
    }

    private async processNext() {
        while (this.runningCount < this.maxConcurrent && this.pending.length > 0) {
            const id = this.pending.shift()!;
            const task = this.tasks.get(id);
            if (!task || task.status !== "pending") continue;

            this.runningCount++;
            task.status = "running";
            task.startedAt = new Date();
            task.executor = new AgentExecutor();

            log.info(`Ejecutando tarea: ${id}`);
            broadcast({ type: "task_started", id });

            if (task.speak) task.speak(`Comenzando tarea: ${task.goal.slice(0, 50)}...`);

            // Run async — don't block the loop
            this._run(task).finally(() => {
                this.runningCount--;
                this.processNext();
            });
        }
    }

    private async _run(task: Task): Promise<void> {
        try {
            const result = await task.executor!.executeGoal(task.goal, (msg: string) => {
                task.output.push(msg);
                if (task.speak) task.speak(msg);
            });

            task.status = "done";
            task.result = result;
            task.endedAt = new Date();
            log.info(`Tarea completada: ${task.id}`);
            broadcast({ type: "task_done", id: task.id, result: result?.slice(0, 200) });

            if (task.speak) task.speak(`Tarea completada: ${result?.slice(0, 80)}`);
        } catch (e: any) {
            task.status = "failed";
            task.error = e.message;
            task.endedAt = new Date();
            log.error(`Tarea fallida: ${task.id}`, e.message);
            broadcast({ type: "task_failed", id: task.id, error: e.message });
        }
    }

    /**
     * Cancel a running or pending task.
     */
    cancel(id: string): boolean {
        const task = this.tasks.get(id);
        if (!task) return false;

        if (task.status === "pending") {
            task.status = "cancelled";
            task.endedAt = new Date();
            this.pending = this.pending.filter(pid => pid !== id);
            log.info(`Tarea cancelada (pendiente): ${id}`);
            broadcast({ type: "task_cancelled", id });
            return true;
        }

        if (task.status === "running" && task.executor) {
            task.executor.cancel();
            task.status = "cancelled";
            task.endedAt = new Date();
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
    status(id: string): { id: string; status: string; goal: string; output_lines: number; result?: string; error?: string } | undefined {
        const task = this.tasks.get(id);
        if (!task) return undefined;
        return {
            id: task.id,
            status: task.status,
            goal: task.goal,
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
    listAll(): Array<{ id: string; goal: string; status: string; priority: string; createdAt: string }> {
        return Array.from(this.tasks.values()).map(t => ({
            id: t.id,
            goal: t.goal.slice(0, 80),
            status: t.status,
            priority: TaskPriority[t.priority],
            createdAt: t.createdAt.toISOString(),
        }));
    }

    /**
     * Prune completed/failed/cancelled tasks older than maxAgeMs.
     */
    prune(maxAgeMs = 30 * 60_000): void {
        const now = Date.now();
        for (const [id, task] of this.tasks.entries()) {
            const terminal = ["done", "failed", "cancelled"].includes(task.status);
            const age = task.endedAt ? now - task.endedAt.getTime() : 0;
            if (terminal && age > maxAgeMs) {
                this.tasks.delete(id);
            }
        }
    }
}

export const getQueue = () => TaskQueue.getInstance();

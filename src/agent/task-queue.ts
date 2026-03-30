import { AgentExecutor } from "./executor.js";

export enum TaskPriority {
    LOW = 1,
    NORMAL = 2,
    HIGH = 3,
}

export interface Task {
    id: string;
    goal: string;
    priority: TaskPriority;
    status: "pending" | "running" | "done" | "failed";
    createdAt: Date;
    result?: string;
    speak?: (msg: string) => void;
}

class TaskQueue {
    private queue: Task[] = [];
    private isProcessing = false;
    private executor = new AgentExecutor();
    private static instance: TaskQueue;

    static getInstance(): TaskQueue {
        if (!TaskQueue.instance) TaskQueue.instance = new TaskQueue();
        return TaskQueue.instance;
    }

    submit(goal: string, priority: TaskPriority = TaskPriority.NORMAL, speak?: (msg: string) => void): string {
        const id = `task_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
        const task: Task = { id, goal, priority, status: "pending", createdAt: new Date(), speak };
        
        // Insertar por prioridad (mayor primero)
        const insertIdx = this.queue.findIndex(t => t.priority < priority);
        if (insertIdx === -1) this.queue.push(task);
        else this.queue.splice(insertIdx, 0, task);

        console.log(`[Task Queue] 📥 Nueva tarea "${id}" (prioridad: ${TaskPriority[priority]}): ${goal.slice(0, 60)}`);
        
        this.processNext();
        return id;
    }

    private async processNext() {
        if (this.isProcessing || this.queue.length === 0) return;

        const task = this.queue.find(t => t.status === "pending");
        if (!task) return;

        this.isProcessing = true;
        task.status = "running";

        console.log(`[Task Queue] ▶️ Ejecutando tarea: ${task.id}`);
        if (task.speak) task.speak(`Comenzando tarea: ${task.goal.slice(0, 50)}...`);

        try {
            task.result = await this.executor.executeGoal(task.goal, task.speak);
            task.status = "done";
            console.log(`[Task Queue] ✅ Tarea completada: ${task.id}`);
            if (task.speak) task.speak(`Tarea completada: ${task.result?.slice(0, 80)}`);
        } catch (e: any) {
            task.status = "failed";
            task.result = e.message;
            console.error(`[Task Queue] ❌ Tarea fallida: ${task.id}`, e);
        } finally {
            this.isProcessing = false;
            this.processNext(); // procesar la siguiente en cola
        }
    }

    status(id: string): Task | undefined {
        return this.queue.find(t => t.id === id);
    }

    listAll(): Task[] {
        return [...this.queue];
    }
}

export const getQueue = () => TaskQueue.getInstance();

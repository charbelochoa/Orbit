/**
 * Orbit Task Tools — Phase 7
 * task_create, task_get, task_list, task_stop, task_output
 * Allows the agent to spawn background tasks and query their status.
 */
import { getQueue, TaskPriority } from "../agent/task-queue.js";

export async function taskCreate(args: { description: string; prompt?: string; priority?: string }): Promise<string> {
    const goal = args.prompt || args.description;
    if (!goal) return "Error: se requiere 'description' o 'prompt' para crear una tarea.";

    const priority = args.priority === "high" ? TaskPriority.HIGH
        : args.priority === "low" ? TaskPriority.LOW
        : TaskPriority.NORMAL;

    const id = getQueue().submit(goal, priority);
    return JSON.stringify({ task_id: id, status: "pending", goal: goal.slice(0, 80) });
}

export async function taskGet(args: { task_id: string }): Promise<string> {
    if (!args.task_id) return "Error: se requiere 'task_id'.";

    const info = getQueue().status(args.task_id);
    if (!info) return `Tarea '${args.task_id}' no encontrada.`;

    return JSON.stringify(info, null, 2);
}

export async function taskList(): Promise<string> {
    const tasks = getQueue().listAll();
    if (tasks.length === 0) return "No hay tareas en la cola.";
    return JSON.stringify(tasks, null, 2);
}

export async function taskStop(args: { task_id: string }): Promise<string> {
    if (!args.task_id) return "Error: se requiere 'task_id'.";

    const ok = getQueue().cancel(args.task_id);
    return ok
        ? `Tarea '${args.task_id}' cancelada.`
        : `No se pudo cancelar '${args.task_id}' (no existe o ya terminó).`;
}

export async function taskOutput(args: { task_id: string; from_line?: number }): Promise<string> {
    if (!args.task_id) return "Error: se requiere 'task_id'.";

    const lines = getQueue().output(args.task_id, args.from_line || 0);
    if (lines.length === 0) return "Sin output aún.";
    return lines.join("\n");
}

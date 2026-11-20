/**
 * /cancel <taskId>
 * Marks a queued or running task as cancelled.
 */

import { getQueue }            from "../../agent/task-queue.js";
import type { CommandHandler } from "../types.js";

export const cancelCommand: CommandHandler = async (ctx) => {
    const taskId = ctx.args[0] ?? "";
    if (!taskId) {
        return "Uso: /cancel <taskId>\nEjemplo: /cancel task_1234567_abcde";
    }

    const task = getQueue().status(taskId);
    if (!task) {
        return `Tarea "${taskId}" no encontrada. Usa /status para ver las tareas activas.`;
    }
    if (!getQueue().cancel(taskId)) {
        return `La tarea "${taskId}" ya terminó con estado: ${task.status}.`;
    }

    return `Tarea ${taskId} cancelada.`;
};

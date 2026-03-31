/**
 * /task <goal>
 * Enqueues a high-priority agent task.
 */

import { getQueue, TaskPriority } from "../../agent/task-queue.js";
import type { CommandHandler }    from "../types.js";

export const taskCommand: CommandHandler = async (ctx) => {
    // Strip the leading "/task" to get the bare goal string
    const goal = ctx.rawText.replace(/^\/task\s*/i, "").trim();

    if (!goal) {
        return [
            "Uso: /task <objetivo>",
            "Ejemplo: /task investiga los mejores frameworks de IA 2026 y guarda un resumen",
        ].join("\n");
    }

    const taskId = getQueue().submit(goal, TaskPriority.HIGH, ctx.speakFn);
    ctx.sendReply({ type: "task_queued", taskId, goal });
    return `Tarea iniciada (${taskId}):\n${goal.slice(0, 120)}`;
};

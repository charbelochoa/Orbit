/**
 * /cancel <taskId>
 * Marks a queued or running task as cancelled.
 */

import { cancelWork }          from "../../agent/delegated-jobs.js";
import type { CommandHandler } from "../types.js";

export const cancelCommand: CommandHandler = async (ctx) => {
    const taskId = ctx.args[0] ?? "";
    if (!taskId) {
        return "Uso: /cancel <id de tarea, grupo o subagente>";
    }

    return cancelWork(taskId)
        ? `Se solicitó la cancelación de ${taskId}.`
        : `${taskId} no está en ejecución ni en espera. Usa /status para ver el trabajo activo.`;
};

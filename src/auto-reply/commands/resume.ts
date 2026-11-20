import { getQueue } from "../../agent/task-queue.js";
import type { CommandHandler } from "../types.js";

export const resumeCommand: CommandHandler = async ({ args }) => {
    const [id, flag, ...extra] = args;
    if (!id || (flag && flag !== "--retry-interrupted") || extra.length) {
        return "Uso: /resume <id> [--retry-interrupted]";
    }
    const outcome = getQueue().continueTask(id, flag === "--retry-interrupted");
    if (outcome === "queued") return `Tarea ${id} en cola para continuar.`;
    if (outcome === "needs_confirmation") {
        return `Orbit desconoce el resultado de algunos pasos. Revisa sus efectos antes de repetirlos con /resume ${id} --retry-interrupted.`;
    }
    return `La tarea ${id} no está disponible para continuar. Consulta /status.`;
};

/**
 * /rewind — Deshacer los últimos N turnos del chat
 *
 * Emite un evento rewind_request para que el gateway limpie
 * los últimos mensajes del historial del modelo.
 */
import type { CommandHandler } from "../types.js";

export const rewindCommand: CommandHandler = async (ctx) => {
    const n = parseInt(ctx.subcommand, 10);
    const turns = isNaN(n) || n < 1 ? 1 : Math.min(n, 20);

    ctx.sendReply({
        type:  "rewind_request",
        turns,
    });

    return `⏪ Rebobinando ${turns} turno${turns > 1 ? "s" : ""}…`;
};

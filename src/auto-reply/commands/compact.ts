/**
 * /compact — Resumir conversación y liberar contexto
 *
 * Envía al modelo un prompt para que resuma la conversación actual,
 * luego limpia el historial e inyecta el resumen como contexto.
 */
import type { CommandHandler } from "../types.js";

export const compactCommand: CommandHandler = async (ctx) => {
    const instructions = ctx.argStr.trim();

    ctx.sendReply({ type: "orbit_chunk", text: "Resumiendo conversación..." });

    // Tell the gateway to compact: it will summarize the chat, clear history,
    // inject the summary. The gateway/index.ts handles the summarize-then-clear flow.
    ctx.sendReply({
        type:         "compact_request",
        instructions: instructions || undefined,
    });

    return instructions
        ? `Compactando conversación con instrucciones: "${instructions}"`
        : "Compactando conversación… El resumen se inyectará como contexto.";
};

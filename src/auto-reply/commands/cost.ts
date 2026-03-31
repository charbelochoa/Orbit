/**
 * /cost — Muestra uso de tokens y costo estimado de la sesión
 */
import type { CommandHandler } from "../types.js";
import { getTokenState } from "../../gateway/server.js";

// Approximate pricing per 1M tokens (USD) — update as providers change
const PRICING: Record<string, { input: number; output: number }> = {
    gemini:    { input: 1.25,  output: 5.00  },
    openai:    { input: 3.00,  output: 15.00 },
    anthropic: { input: 3.00,  output: 15.00 },
    ollama:    { input: 0,     output: 0     },
};

function fmt(n: number): string {
    return n.toLocaleString("en-US");
}

export const costCommand: CommandHandler = async (ctx) => {
    const state = getTokenState();

    const model  = "gemini"; // TODO: read active model from config
    const prices = PRICING[model] || PRICING.gemini;
    const inCost  = (state.inputTokens  / 1_000_000) * prices.input;
    const outCost = (state.outputTokens / 1_000_000) * prices.output;
    const total   = inCost + outCost;

    const pct = Math.round((state.totalTokens / state.contextWindow) * 100);

    const lines = [
        `**Uso de tokens — sesión actual**`,
        ``,
        `  Tokens de entrada:   ${fmt(state.inputTokens).padStart(10)}  ($${inCost.toFixed(4)})`,
        `  Tokens de salida:    ${fmt(state.outputTokens).padStart(10)}  ($${outCost.toFixed(4)})`,
        `  ─────────────────────────────────`,
        `  **Total sesión:      ${fmt(state.totalTokens).padStart(10)}  ($${total.toFixed(4)})**`,
        ``,
        `  Ventana de contexto: ${fmt(state.contextWindow)} (${pct}% usado)`,
        `  Modelo:              ${model}`,
    ];
    return lines.join("\n");
};



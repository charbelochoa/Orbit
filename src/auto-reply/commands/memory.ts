/**
 * /memory show | /memory search <query>
 * Reads and searches the long-term memory store.
 */

import { loadMemory }          from "../../memory/memory-manager.js";
import type { CommandHandler } from "../types.js";

export const memoryCommand: CommandHandler = async (ctx) => {
    const sub = ctx.subcommand;
    const mem = await loadMemory();

    // ── show (default) ───────────────────────────────────────────────────────
    if (!sub || sub === "show") {
        ctx.sendReply({ type: "memory_data", data: mem });

        const sections = (Object.entries(mem) as [string, Record<string, any>][])
            .map(([key, vals]) => {
                const entries = Object.entries(vals)
                    .map(([k, v]) => `  ${k}: ${(v as any)?.value ?? v}`)
                    .join("\n");
                return `**${key}**\n${entries || "  (vacío)"}`;
            })
            .join("\n\n");
        return sections || "La memoria está vacía.";
    }

    // ── search ───────────────────────────────────────────────────────────────
    if (sub === "search") {
        const query = ctx.argStr.toLowerCase().trim();
        if (!query) return "Uso: /memory search <query>";

        const hits: string[] = [];
        for (const [section, vals] of Object.entries(mem) as [string, Record<string, any>][]) {
            for (const [k, v] of Object.entries(vals)) {
                const haystack = `${k} ${(v as any)?.value ?? ""}`.toLowerCase();
                if (haystack.includes(query)) {
                    hits.push(`[${section}] ${k}: ${(v as any)?.value ?? v}`);
                }
            }
        }
        return hits.length > 0
            ? `Encontré ${hits.length} resultado(s) para "${ctx.argStr}":\n${hits.join("\n")}`
            : `Sin resultados para "${ctx.argStr}".`;
    }

    // ── clear ────────────────────────────────────────────────────────────────
    if (sub === "clear") {
        return "Para borrar la memoria, elimina el archivo data/memory/long_term.json manualmente.";
    }

    return "Subcomandos: show | search <query>";
};

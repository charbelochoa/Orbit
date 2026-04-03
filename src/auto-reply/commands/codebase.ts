/**
 * Orbit Auto-reply — /codebase (Sprint 13)
 * ──────────────────────────────────────────
 * Subcomandos:
 *   /codebase status              → stats del indexer + errores TS
 *   /codebase search <query>      → búsqueda semántica en el codebase
 *   /codebase errors              → lista errores TypeScript actuales
 *   /codebase index               → fuerza re-indexado completo
 */

import type { CommandContext } from "../types.js";
import { codebaseSearch }       from "../../actions/codebase.js";
import { codebaseIndexer }      from "../../codebase/indexer.js";

export async function codebaseCommand(ctx: CommandContext): Promise<string> {
    const sub  = ctx.subcommand?.toLowerCase() ?? "";
    const rest = ctx.argStr ?? "";

    switch (sub) {
        case "status":
        case "":
            return codebaseSearch({ query: "", action: "status" });

        case "errors":
            return codebaseSearch({ query: "", action: "errors" });

        case "search": {
            const query = rest.trim();
            if (!query) return "Uso: `/codebase search <consulta>`";
            return codebaseSearch({ query });
        }

        case "index": {
            if (!codebaseIndexer.isRunning()) {
                return "⚠️ El indexer no está activo (`codebase.enabled: false` en config).";
            }
            void codebaseIndexer.reindexAll().catch(() => undefined);
            return "♻️ Re-indexado completo iniciado. Puede tardar unos segundos.";
        }

        default:
            return [
                "Subcomandos disponibles:",
                "• `/codebase status` — estado del indexer y conteo de errores",
                "• `/codebase search <query>` — búsqueda semántica en el código",
                "• `/codebase errors` — lista errores TypeScript actuales",
                "• `/codebase index` — forzar re-indexado completo",
            ].join("\n");
    }
}

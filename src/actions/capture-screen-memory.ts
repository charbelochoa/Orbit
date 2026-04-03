/**
 * capture_screen_memory action — Sprint 6
 * Takes a screenshot, generates an AI caption via Gemini Flash, and indexes
 * the result in the Visual Memory Store for future semantic search.
 *
 * Also supports:
 *   action: "search"  → searchVisual(query)
 *   action: "recent"  → getRecentScreenshots(limit)
 *   action: "stats"   → visualMemoryStats()
 *   action: "capture" (default) → captureAndIndex()
 */

import {
    captureAndIndex,
    indexScreenshot,
    searchVisual,
    getRecentScreenshots,
    visualMemoryStats,
    pruneOldEntries,
    type VisualEntry,
} from "../memory/visual-memory.js";
import { createLogger } from "../infra/logger.js";

const log = createLogger("visual-memory");

function formatEntry(e: VisualEntry): string {
    const d  = new Date(e.timestamp).toLocaleString("es-ES");
    const sc = e.score !== undefined ? ` [score: ${e.score.toFixed(2)}]` : "";
    return `- [${d}]${sc} ${e.caption}`;
}

export async function captureScreenMemory(args: any): Promise<string> {
    const action = (args?.action || "capture").toLowerCase();

    switch (action) {
        // ── capture (default) ────────────────────────────────────────────────
        case "capture":
        case "index": {
            const entry = await captureAndIndex({
                sessionId:      args?.sessionId,
                captionPrompt:  args?.prompt,
                storeThumbnail: args?.storeThumbnail === true,
            });
            if (!entry) return "Visual memory desactivada o captura fallida. Activa memory.visual.enabled en orbit.yaml.";
            return `✅ Screenshot indexado [id=${entry.id}]\n📝 Caption: ${entry.caption}`;
        }

        // ── index pre-captured ───────────────────────────────────────────────
        case "index_base64": {
            if (!args?.base64) return "Falta parámetro 'base64' con la imagen PNG/JPEG en base64.";
            const entry = await indexScreenshot(args.base64, {
                sessionId:      args?.sessionId,
                captionPrompt:  args?.prompt,
                storeThumbnail: args?.storeThumbnail === true,
            });
            if (!entry) return "Error al indexar la imagen.";
            return `✅ Imagen indexada [id=${entry.id}]\n📝 Caption: ${entry.caption}`;
        }

        // ── search ───────────────────────────────────────────────────────────
        case "search": {
            const query = (args?.query || "").trim();
            if (!query) return "Falta parámetro 'query' para buscar en visual memory.";
            const topK   = typeof args?.topK === "number" ? args.topK : 5;
            const hits   = await searchVisual(query, topK);
            if (hits.length === 0) return `No se encontraron resultados para "${query}" en visual memory.`;
            return `**Visual memory** — ${hits.length} resultado(s) para "${query}":\n${hits.map(formatEntry).join("\n")}`;
        }

        // ── recent ───────────────────────────────────────────────────────────
        case "recent": {
            const limit   = typeof args?.limit === "number" ? args.limit : 10;
            const entries = getRecentScreenshots(limit);
            if (entries.length === 0) return "Visual memory vacía — no hay screenshots indexados aún.";
            return `**Últimos ${entries.length} screenshots indexados:**\n${entries.map(formatEntry).join("\n")}`;
        }

        // ── stats ────────────────────────────────────────────────────────────
        case "stats": {
            const s     = visualMemoryStats();
            const oldest = s.oldest ? new Date(s.oldest).toLocaleString("es-ES") : "—";
            const newest = s.newest ? new Date(s.newest).toLocaleString("es-ES") : "—";
            return `**Visual Memory Stats**\n- Total entradas: ${s.total}\n- Más antigua: ${oldest}\n- Más reciente: ${newest}`;
        }

        // ── prune ────────────────────────────────────────────────────────────
        case "prune": {
            const deleted = pruneOldEntries();
            return deleted > 0
                ? `🗑️ Eliminadas ${deleted} entradas antiguas de visual memory.`
                : "No hay entradas antiguas que eliminar.";
        }

        default:
            return `Acción '${action}' desconocida. Opciones: capture | index_base64 | search | recent | stats | prune`;
    }
}

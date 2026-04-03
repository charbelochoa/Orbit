/**
 * Orbit Action — codebase_search (Sprint 13)
 * ────────────────────────────────────────────
 * Búsqueda semántica / FTS en el índice del codebase del proyecto.
 * Usa el CodebaseIndexer (VectorMemoryStore separado en data/codebase.db).
 */

import { codebaseIndexer } from "../codebase/indexer.js";
import { errorWatcher }    from "../codebase/error-watcher.js";

interface CodebaseSearchParams {
    /** Consulta de búsqueda (lenguaje natural o nombre de símbolo) */
    query:  string;
    /** Número máximo de resultados (1-20, default: 6) */
    topK?:  number;
    /** Filtrar por extensión: ".ts" | ".py" | ".md" etc. */
    ext?:   string;
    /** "search" (default) | "status" | "errors" */
    action?: string;
}

export async function codebaseSearch(params: CodebaseSearchParams): Promise<string> {
    const action = params.action ?? "search";

    if (action === "status") {
        return _formatStatus();
    }

    if (action === "errors") {
        return _formatErrors();
    }

    // ── Búsqueda semántica ───────────────────────────────────────────────────
    const query = (params.query ?? "").trim();
    if (!query) return "Proporciona una consulta de búsqueda.";

    if (!codebaseIndexer.isRunning()) {
        return "⚠️ El índice del codebase no está activo. Actívalo con `codebase.enabled: true` en config/orbit.yaml.";
    }

    const topK = Math.min(Math.max(params.topK ?? 6, 1), 20);
    let results = await codebaseIndexer.search(query, topK + 4); // pedir extra para filtrar

    // Filtrar por extensión si se especificó
    if (params.ext) {
        const extFilter = params.ext.startsWith(".") ? params.ext : `.${params.ext}`;
        results = results.filter(r => r.source.endsWith(extFilter));
    }

    results = results.slice(0, topK);

    if (results.length === 0) {
        return `No encontré coincidencias para: "${query}"`;
    }

    const lines: string[] = [
        `## Resultados del codebase: "${query}"`,
        `*${results.length} resultado(s) encontrado(s)*`,
        "",
    ];

    for (const r of results) {
        const relPath = r.source.replace(/^codebase:/, "");
        const score   = (r.score * 100).toFixed(0);
        lines.push(`### \`${relPath}\` *(relevancia: ${score}%)*`);
        lines.push("```");
        lines.push(r.snippet.trim().slice(0, 500));
        lines.push("```");
        lines.push("");
    }

    return lines.join("\n");
}

function _formatStatus(): string {
    const s = codebaseIndexer.getStats();
    const errs = errorWatcher.getErrorCount();
    return [
        `## Estado del índice de codebase`,
        "",
        `**Indexer activo**: ${s.running ? "✅ sí" : "❌ no"}`,
        `**Archivos indexados**: ${s.files}`,
        `**Chunks totales**: ${s.chunks}`,
        `**Embeddings vectoriales**: ${s.embeddings}`,
        `**Error watcher activo**: ${errorWatcher.isRunning() ? "✅ sí" : "❌ no"}`,
        `**Errores TS actuales**: ${errs} ${errs > 0 ? "⚠️" : "✅"}`,
    ].join("\n");
}

function _formatErrors(): string {
    const errors = errorWatcher.getErrors();
    if (errors.length === 0) return "✅ Sin errores TypeScript detectados.";

    const lines = [
        `## Errores TypeScript detectados (${errors.length})`,
        "",
        "| Archivo | Línea | Código | Mensaje |",
        "|---------|-------|--------|---------|",
    ];
    for (const e of errors.slice(0, 30)) {
        const file = e.file.replace(/^codebase:/, "").slice(-50);
        lines.push(`| \`${file}\` | ${e.line} | \`${e.code}\` | ${e.message.slice(0, 80)} |`);
    }
    if (errors.length > 30) lines.push(`\n*...y ${errors.length - 30} más*`);
    return lines.join("\n");
}

/**
 * /insights — Session analytics (Phase 8.4)
 * Shows usage patterns: most frequent tasks, tools, modified files.
 */

import { getAllSessions, getHistory } from "../../memory/chat-history.js";
import { providerRegistry }          from "../../providers/registry.js";
import { toolRegistry }              from "../../core/registry.js";
import type { CommandHandler }       from "../types.js";

export const insightsCommand: CommandHandler = async (ctx) => {
    const sessions = getAllSessions();
    if (sessions.length === 0) return "No hay sesiones registradas aún.";

    // Analyze last 30 sessions
    const maxSessions = 30;
    const recentSessions = sessions.slice(0, maxSessions);

    let totalMessages  = 0;
    let userMessages   = 0;

    // Pattern counters
    const taskPatterns = new Map<string, number>();
    const toolMentions = new Map<string, number>();
    const fileMentions = new Map<string, number>();

    for (const sid of recentSessions) {
        const msgs = getHistory(sid, 200);
        totalMessages += msgs.length;

        for (const msg of msgs) {
            if (msg.role === "user") {
                userMessages++;
                categorizeRequest(msg.content, taskPatterns);
            }
            // Both roles: detect tool names and file paths
            extractToolMentions(msg.content, toolMentions);
            extractFileMentions(msg.content, fileMentions);
        }
    }

    // Sort by frequency
    const topTasks = sortMap(taskPatterns, 5);
    const topTools = sortMap(toolMentions, 5);
    const topFiles = sortMap(fileMentions, 5);
    const totalTasks = sumMap(taskPatterns);

    // Provider health
    const health = providerRegistry.getHealthStats();
    const provLines = Object.values(health).map(h => {
        const successRate = h.totalCalls > 0
            ? Math.round(((h.totalCalls - (h as any).totalErrors) / h.totalCalls) * 100)
            : 0;
        const status = h.available ? (h.cooldownUntil > Date.now() ? "⏳" : "✅") : "❌";
        return `  ${status} ${h.id}: ${h.totalCalls} calls, ${successRate}% ok, ~${h.avgLatencyMs}ms`;
    });

    const lines = [
        `📊 **Análisis de tus últimas ${recentSessions.length} sesiones:**`,
        `   ${totalMessages} mensajes totales (${userMessages} tuyos)`,
        "",
    ];

    if (topTasks.length > 0) {
        lines.push("**Tareas más frecuentes:**");
        for (const [label, count] of topTasks) {
            const pct = Math.round((count / totalTasks) * 100);
            lines.push(`  - ${label} (${pct}%)`);
        }
        lines.push("");
    }

    if (topTools.length > 0) {
        lines.push("**Herramientas más usadas:**");
        for (const [name, count] of topTools) {
            lines.push(`  - ${name}: ${count.toLocaleString()} veces`);
        }
        lines.push("");
    }

    if (topFiles.length > 0) {
        lines.push("**Archivos más mencionados:**");
        for (const [f, count] of topFiles) {
            lines.push(`  - ${f} (${count} menciones)`);
        }
        lines.push("");
    }

    if (provLines.length > 0) {
        lines.push("**Salud de providers:**");
        lines.push(...provLines);
    }

    return lines.join("\n");
};

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Categorize a user message into a task pattern. */
function categorizeRequest(text: string, map: Map<string, number>): void {
    const lower = text.toLowerCase();
    const patterns: [RegExp, string][] = [
        [/refactor|refactori/,           "Refactoring"],
        [/bug|error|fix|arregl/,         "Debug / Fix errores"],
        [/test|prueba|spec/,             "Testing"],
        [/doc|readme|comment/,           "Documentación"],
        [/crea|generat?e?|new|nuevo/,    "Crear código nuevo"],
        [/explic|explain|qué hace/,      "Explicaciones"],
        [/review|revis/,                 "Code review"],
        [/optimi|perf|rápid|lent/,       "Optimización"],
        [/deploy|build|compil/,          "Build / Deploy"],
        [/busca|search|find|encuentra/,  "Búsqueda"],
    ];
    for (const [rx, label] of patterns) {
        if (rx.test(lower)) {
            map.set(label, (map.get(label) || 0) + 1);
            return;
        }
    }
    map.set("General", (map.get("General") || 0) + 1);
}

/** Extract tool names mentioned in message content. */
function extractToolMentions(text: string, map: Map<string, number>): void {
    const toolNames = ["file_edit", "bash", "glob", "grep", "web_fetch", "todo",
                       "file_read", "file_write", "task_create", "mcp"];
    for (const name of toolNames) {
        if (text.includes(name)) {
            map.set(name, (map.get(name) || 0) + 1);
        }
    }
}

/** Extract file paths mentioned in message content. */
function extractFileMentions(text: string, map: Map<string, number>): void {
    // Match common file path patterns
    const fileRx = /(?:^|\s)((?:[\w.-]+\/)+[\w.-]+\.\w{1,10})/g;
    let m;
    while ((m = fileRx.exec(text)) !== null) {
        const file = m[1];
        // Skip URLs and very long paths
        if (file.includes("http") || file.length > 100) continue;
        map.set(file, (map.get(file) || 0) + 1);
    }
}

function sortMap(map: Map<string, number>, limit: number): [string, number][] {
    return [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit);
}

function sumMap(map: Map<string, number>): number {
    let s = 0;
    for (const v of map.values()) s += v;
    return s;
}

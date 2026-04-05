/**
 * /batch — Fase 5 (OfficeCLI pipeline)
 *
 * Envía múltiples objetivos como tareas secuenciales al Task Queue.
 *
 * Sintaxis soportada:
 *   /batch goal1 && goal2 && goal3
 *   /batch goal1
 *         goal2
 *         goal3
 *   /batch ["goal1", "goal2", "goal3"]   (JSON array)
 *
 * Cada goal se encola como TaskPriority.NORMAL. Las tareas se ejecutan
 * en el orden en que son sometidas; el Queue las serializa automáticamente
 * si están en la misma prioridad.
 */

import { getQueue, TaskPriority } from "../../agent/task-queue.js";
import type { CommandHandler }    from "../types.js";

export const batchCommand: CommandHandler = async (ctx) => {
    // Strip the leading "/batch" to get the raw argument string
    const raw = ctx.rawText.replace(/^\/batch\s*/i, "").trim();

    if (!raw) {
        return [
            "Uso: /batch <objetivo1> && <objetivo2> && ...",
            "",
            "También puedes separar por líneas:",
            "  /batch",
            "  Investiga el framework X",
            "  Escribe un resumen en docs/X.md",
            "  Abre el archivo y verifica el contenido",
            "",
            "O pasar un JSON array:",
            '  /batch ["objetivo 1", "objetivo 2"]',
        ].join("\n");
    }

    // ── Parse goals ─────────────────────────────────────────────────────────
    let goals: string[] = [];

    // 1. Try JSON array  (must start with '[')
    if (raw.startsWith("[")) {
        try {
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed) && parsed.every(g => typeof g === "string")) {
                goals = parsed.map(g => g.trim()).filter(Boolean);
            }
        } catch {
            // fall through to other parsers
        }
    }

    // 2. Try && separator
    if (!goals.length && raw.includes("&&")) {
        goals = raw.split("&&").map(g => g.trim()).filter(Boolean);
    }

    // 3. Multiline (each non-empty line is a goal)
    if (!goals.length) {
        goals = raw.split(/\r?\n/).map(g => g.trim()).filter(Boolean);
    }

    if (!goals.length) {
        return "No se detectaron objetivos válidos. Usa '&&' o líneas separadas para múltiples goals.";
    }

    // ── Enqueue each goal ───────────────────────────────────────────────────
    const taskIds: string[] = [];
    for (const goal of goals) {
        const taskId = getQueue().submit(goal, TaskPriority.NORMAL, ctx.speakFn);
        taskIds.push(taskId);
        ctx.sendReply({ type: "task_queued", taskId, goal });
    }

    const lines = [
        `✓ Pipeline de ${goals.length} tarea(s) iniciado:`,
        "",
        ...goals.map((g, i) => `  ${i + 1}. (${taskIds[i]}) ${g.slice(0, 80)}${g.length > 80 ? "…" : ""}`),
        "",
        "Usa /status para ver el progreso.",
    ];
    return lines.join("\n");
};

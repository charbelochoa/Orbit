/**
 * Orbit Action — get_mood_context (Sprint 11)
 * ─────────────────────────────────────────────
 * Tool para que el agente consulte el estado de ánimo/trabajo actual del usuario.
 * Combina MoodEngine + PatternLearner en un resumen legible.
 */

import { ambientService }  from "../ambient/service.js";
import { moodEngine }      from "../ambient/mood-engine.js";
import { patternLearner }  from "../ambient/pattern-learner.js";

interface MoodContextParams {
    /** "summary" (default) | "patterns" | "session" */
    view?: string;
}

export async function getMoodContext(params: MoodContextParams = {}): Promise<string> {
    const view = params.view ?? "summary";

    if (!ambientService.isRunning()) {
        return "⚠️ El Ambient Service no está activo. Actívalo con `/ambient on` y espera unos segundos.";
    }

    if (view === "patterns") {
        return _formatPatterns();
    }

    if (view === "session") {
        return _formatSessionUsage();
    }

    // Default: summary completo
    const mood = moodEngine.evaluate();
    const snap = ambientService.getSnapshot();
    const top  = patternLearner.getTopAppsToday();

    const stateEmoji: Record<string, string> = {
        focused:       "🎯",
        researching:   "🔍",
        browsing:      "🌐",
        switching:     "⚡",
        idle:          "😴",
        email:         "📧",
        entertainment: "🎬",
        unknown:       "❓",
    };

    const lines: string[] = [
        `## Estado de trabajo actual`,
        ``,
        `${stateEmoji[mood.state] ?? "❓"} **Estado**: ${mood.state}`,
        `🖥️ **App activa**: ${mood.app ?? "(sin datos)"}`,
        `⏱️ **Tiempo en esta app**: ${mood.minutesInApp} min`,
        `🔄 **Cambios de ventana (10 min)**: ${mood.switchCount10m}`,
        ``,
    ];

    if (mood.expectedApp) {
        lines.push(
            `📊 **Rutina esperada para esta hora**: ${mood.expectedApp}`,
            `✅ **Dentro de rutina**: ${mood.onRoutine ? "Sí" : "No"}`,
            ``,
        );
    }

    if (snap.recentClipboard) {
        lines.push(
            `📋 **Portapapeles reciente**: tipo ${snap.recentClipboard.type}, ${snap.recentClipboard.text.slice(0, 80)}${snap.recentClipboard.text.length > 80 ? "…" : ""}`,
            ``,
        );
    }

    if (top.length > 0) {
        lines.push(`🏆 **Top apps de hoy**:`);
        for (const { app, count } of top) {
            lines.push(`  • ${app}: ${count} registros`);
        }
    }

    return lines.join("\n");
}

function _formatPatterns(): string {
    const today  = new Date().getDay();
    const dayNames = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
    const lines: string[] = [`## Patrones aprendidos — ${dayNames[today]}`];

    const hour = new Date().getHours();
    const slots = [6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22];

    lines.push("", "| Hora | App dominante |", "|------|---------------|");
    for (const h of slots) {
        const app = patternLearner.getDominantApp(h, today);
        const marker = h === hour ? " ← ahora" : "";
        lines.push(`| ${String(h).padStart(2)}:00 | ${app ?? "(sin datos)"}${marker} |`);
    }
    return lines.join("\n");
}

function _formatSessionUsage(): string {
    const usage  = patternLearner.getSessionUsage();
    const entries = Object.entries(usage).sort((a, b) => b[1] - a[1]).slice(0, 10);
    if (!entries.length) return "Aún no hay datos de uso en esta sesión.";

    const lines = [`## Uso de apps en esta sesión`, ""];
    for (const [app, count] of entries) {
        lines.push(`  • **${app}**: ${count} ventanas detectadas`);
    }
    return lines.join("\n");
}

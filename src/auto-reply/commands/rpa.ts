/**
 * /rpa — Slash command for the RPA Recorder (Sprint 7)
 *
 * Usage:
 *   /rpa start <nombre>         — Inicia una grabación
 *   /rpa stop <session_id>      — Finaliza y guarda
 *   /rpa list                   — Lista macros guardadas
 *   /rpa replay <id> [x<loops>] — Reproduce una macro
 *   /rpa delete <id>            — Elimina una macro
 *   /rpa export <id>            — Muestra el SKILL.md generado
 *   /rpa install <id>           — Instala como skill
 *   /rpa status                 — Sesiones activas
 *   /rpa show <id>              — Detalle de una macro
 */

import {
    startRecording,
    stopRecording,
    listMacros,
    replayMacro,
    deleteMacro,
    getMacro,
    exportAsSkill,
    installMacroAsSkill,
    getActiveSessions,
} from "../../actions/rpa-recorder.js";
import type { CommandHandler } from "../types.js";

export const rpaCommand: CommandHandler = async (ctx) => {
    const sub  = ctx.subcommand;
    const rest = ctx.argStr.trim();

    // ── start ─────────────────────────────────────────────────────────────────
    if (sub === "start") {
        const name = rest || "Grabación sin nombre";
        const id   = startRecording(name);
        ctx.sendReply({ type: "rpa_started", sessionId: id, name });
        return `🔴 **Grabación iniciada**\nID de sesión: \`${id}\`\nNombre: **${name}**\n\nAhora el agente puede añadir pasos con \`rpa_record action=step session_id=${id} step_action=<tipo> ...\`\nFinaliza con \`/rpa stop ${id}\`.`;
    }

    // ── stop ──────────────────────────────────────────────────────────────────
    if (sub === "stop") {
        const parts = rest.split(/\s+/);
        const sessionId = parts[0] || "";
        if (!sessionId) {
            const active = getActiveSessions();
            if (active.length === 1) {
                // Conveniente: si hay solo una sesión activa, úsala
                const rec = await stopRecording(active[0].id, "");
                ctx.sendReply({ type: "rpa_stopped", macroId: rec.id });
                return `⏹️ **Grabación guardada**\nID macro: \`${rec.id}\` | Pasos: ${rec.stepCount} | Duración: ${((rec.durationMs || 0) / 1000).toFixed(1)}s`;
            }
            return "Indica el session_id: `/rpa stop <session_id>`";
        }
        const description = parts.slice(1).join(" ");
        const rec = await stopRecording(sessionId, description);
        ctx.sendReply({ type: "rpa_stopped", macroId: rec.id });
        return `⏹️ **Grabación guardada**\nID macro: \`${rec.id}\` | Pasos: ${rec.stepCount} | Duración: ${((rec.durationMs || 0) / 1000).toFixed(1)}s`;
    }

    // ── list ──────────────────────────────────────────────────────────────────
    if (!sub || sub === "list") {
        const macros = await listMacros();
        if (macros.length === 0) {
            return "No hay macros RPA guardadas.\n\nEmpieza con: `/rpa start <nombre>`";
        }
        const lines = macros.map(m => {
            const date = new Date(m.createdAt).toLocaleDateString("es-ES");
            return `- \`${m.id}\` **${m.name}** — ${m.stepCount} pasos | ${date}${m.description ? `\n  _${m.description}_` : ""}`;
        });
        return `**Macros RPA (${macros.length}):**\n${lines.join("\n")}`;
    }

    // ── replay ────────────────────────────────────────────────────────────────
    if (sub === "replay" || sub === "run") {
        const parts = rest.split(/\s+/);
        const id    = parts[0] || "";
        if (!id) return "Usa: `/rpa replay <id> [x<loops>]`";

        // Parse optional loop count: x2, x3, etc.
        let loops = 1;
        const loopArg = parts.find(p => /^x\d+$/i.test(p));
        if (loopArg) loops = parseInt(loopArg.slice(1), 10) || 1;

        ctx.sendReply({ type: "status", text: `▶️ Reproduciendo macro ${id}...` });
        const result = await replayMacro(id, { loops, stepDelay: 250 });

        const icon   = result.success ? "✅" : "⚠️";
        const errMsg = result.errors.length > 0
            ? `\n\nErrores:\n${result.errors.map(e => `  - Paso ${e.step}: ${e.error}`).join("\n")}`
            : "";
        return `${icon} **Replay ${result.success ? "completado" : "con errores"}**\nPasos: ${result.stepsRan} | Tiempo: ${(result.durationMs / 1000).toFixed(1)}s${errMsg}`;
    }

    // ── delete ────────────────────────────────────────────────────────────────
    if (sub === "delete" || sub === "remove") {
        if (!rest) return "Usa: `/rpa delete <id>`";
        const ok = await deleteMacro(rest);
        return ok ? `🗑️ Macro \`${rest}\` eliminada.` : `No se encontró la macro \`${rest}\`.`;
    }

    // ── export ────────────────────────────────────────────────────────────────
    if (sub === "export") {
        if (!rest) return "Usa: `/rpa export <id>`";
        const rec = await getMacro(rest);
        if (!rec) return `Macro \`${rest}\` no encontrada.`;
        const md = exportAsSkill(rec);
        ctx.sendReply({ type: "skill_content", name: rec.name, content: md });
        const preview = md.slice(0, 1000);
        return `**SKILL.md para "${rec.name}":**\n\n\`\`\`markdown\n${preview}${md.length > 1000 ? "\n...(truncado)" : ""}\n\`\`\``;
    }

    // ── install as skill ──────────────────────────────────────────────────────
    if (sub === "install") {
        if (!rest) return "Usa: `/rpa install <id>`";
        const skillPath = await installMacroAsSkill(rest);
        return `✅ Macro instalada como skill:\n\`${skillPath}\`\n\nUsa \`/skills list\` para verla activa.`;
    }

    // ── status ────────────────────────────────────────────────────────────────
    if (sub === "status") {
        const active = getActiveSessions();
        if (active.length === 0) return "No hay grabaciones activas.";
        const lines = active.map(s =>
            `- \`${s.id}\` **${s.name}** — ${s.steps} pasos | ${(s.elapsedMs / 1000).toFixed(0)}s transcurridos`
        );
        return `**Grabaciones activas (${active.length}):**\n${lines.join("\n")}`;
    }

    // ── show / get ────────────────────────────────────────────────────────────
    if (sub === "show" || sub === "get") {
        const id  = rest;
        if (!id) return `Usa: \`/rpa ${sub} <id>\``;
        const rec = await getMacro(id);
        if (!rec) return `Macro \`${id}\` no encontrada.`;
        const steps = rec.steps.map((s, i) => `  ${i + 1}. ${s.comment || s.action}`).join("\n");
        const date  = new Date(rec.createdAt).toLocaleString("es-ES");
        return `**${rec.name}** (\`${rec.id}\`)\n_${rec.description}_\nCreada: ${date} | Pasos: ${rec.stepCount}\n\n${steps}`;
    }

    return "Subcomandos: `start <nombre>` | `stop [session_id]` | `list` | `replay <id>` | `delete <id>` | `export <id>` | `install <id>` | `status` | `show <id>`";
};

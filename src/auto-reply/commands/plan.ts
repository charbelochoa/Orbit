/**
 * /plan — Sprint 8: Plan Mode para revisar y aprobar ejecuciones de herramientas.
 *
 * Subcomandos:
 *   /plan              — activa/desactiva plan mode (toggle)
 *   /plan on           — activa plan mode
 *   /plan off          — desactiva plan mode
 *   /plan show         — muestra pasos planificados
 *   /plan execute      — ejecuta todos los pasos pendientes
 *   /plan clear        — limpia el plan actual
 */

import {
    isPlanMode, enterPlanMode, exitPlanMode, togglePlanMode,
    getPlan, clearPlan, executePlan,
} from "../../agent/plan-mode.js";
import type { CommandContext } from "../types.js";

export async function planCommand(ctx: CommandContext): Promise<string> {
    const [sub] = ctx.args;

    switch (sub) {
        /* ── toggle (no args) ─────────────────────────────────────────── */
        case undefined: {
            const now = togglePlanMode();
            return now
                ? "🗺️ **Plan Mode activado.** Las llamadas a herramientas serán registradas en lugar de ejecutarse.\nUsa `/plan show` para ver los pasos, `/plan execute` para ejecutarlos."
                : "✅ **Plan Mode desactivado.** Las herramientas se ejecutarán normalmente.";
        }

        /* ── on ───────────────────────────────────────────────────────── */
        case "on":
        case "enable":
        case "start": {
            if (isPlanMode()) return "ℹ️ Plan Mode ya está activo.";
            enterPlanMode();
            return "🗺️ **Plan Mode activado.** Las llamadas a herramientas serán registradas.\nUsa `/plan show` para ver el plan y `/plan execute` para ejecutarlo.";
        }

        /* ── off ──────────────────────────────────────────────────────── */
        case "off":
        case "disable":
        case "stop": {
            if (!isPlanMode()) return "ℹ️ Plan Mode ya está desactivado.";
            exitPlanMode();
            return "✅ **Plan Mode desactivado.** Las herramientas se ejecutarán normalmente.";
        }

        /* ── show ─────────────────────────────────────────────────────── */
        case "show":
        case "list": {
            const steps = getPlan();
            if (steps.length === 0) {
                return isPlanMode()
                    ? "🗺️ Plan Mode activo — ningún paso registrado todavía."
                    : "Plan Mode está desactivado y el plan está vacío.";
            }
            const lines = steps.map(s => {
                const status = s.executed ? "✅" : "⏳";
                const res    = s.executed && s.result ? ` → ${s.result.slice(0, 60)}` : "";
                return `  ${status} **${s.index}.** \`${s.toolName}\` — ${s.description}${res}`;
            });
            const modeLabel = isPlanMode() ? "🗺️ Plan Mode **activo**" : "Plan Mode inactivo";
            return `${modeLabel} | **${steps.length} paso(s)**:\n${lines.join("\n")}`;
        }

        /* ── execute ──────────────────────────────────────────────────── */
        case "execute":
        case "exec":
        case "run": {
            const before = getPlan();
            if (before.length === 0) return "El plan está vacío. Activa Plan Mode y ejecuta algunas tareas primero.";
            const pending = before.filter(s => !s.executed);
            if (pending.length === 0) return "Todos los pasos ya fueron ejecutados. Usa `/plan clear` para limpiar.";

            ctx.sendReply({ type: "chat", role: "assistant", text: `▶️ Ejecutando ${pending.length} paso(s)...` });

            const results = await executePlan();

            const lines = results.map(r =>
                `  ✅ **${r.index}.** \`${r.toolName}\` — ${r.result.slice(0, 80)}`
            );
            return `**Plan ejecutado (${results.length} paso(s)):**\n${lines.join("\n")}`;
        }

        /* ── clear ────────────────────────────────────────────────────── */
        case "clear":
        case "reset": {
            clearPlan();
            return "🗑️ Plan limpiado.";
        }

        /* ── status ───────────────────────────────────────────────────── */
        case "status": {
            const steps   = getPlan();
            const done    = steps.filter(s => s.executed).length;
            const pending = steps.length - done;
            const mode    = isPlanMode() ? "🗺️ **activo**" : "⏹️ **inactivo**";
            return `Plan Mode: ${mode} | Pasos totales: ${steps.length} | Pendientes: ${pending} | Ejecutados: ${done}`;
        }

        default:
            return [
                "**Uso: /plan <subcomando>**",
                "  *(sin args)*   — activa / desactiva Plan Mode (toggle)",
                "  `on`           — activa Plan Mode",
                "  `off`          — desactiva Plan Mode",
                "  `show`         — muestra pasos planificados",
                "  `execute`      — ejecuta todos los pasos pendientes",
                "  `clear`        — limpia el plan",
                "  `status`       — muestra estado resumido",
            ].join("\n");
    }
}

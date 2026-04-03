/**
 * Orbit Command: /mood — Sprint 11
 * ──────────────────────────────────
 * Consulta el estado de trabajo/ánimo inferido por MoodEngine + PatternLearner.
 *
 * Subcomandos:
 *   /mood             — resumen del estado actual
 *   /mood status      — igual que arriba
 *   /mood patterns    — tabla de rutinas aprendidas por hora
 *   /mood session     — apps usadas en esta sesión
 *   /mood rules       — estado del rule engine (reglas activas/cooldown)
 */

import { getMoodContext }  from "../../actions/mood-context.js";
import { moodEngine }      from "../../ambient/mood-engine.js";
import { ruleEngine }      from "../../proactive/rule-engine.js";
import type { CommandContext } from "../types.js";

export async function moodCommand(ctx: CommandContext): Promise<string> {
    const sub = (ctx.subcommand || "status").toLowerCase();

    switch (sub) {
        case "status":
        case "": {
            return getMoodContext({ view: "summary" });
        }

        case "patterns":
        case "pattern":
        case "rutinas": {
            return getMoodContext({ view: "patterns" });
        }

        case "session":
        case "sesion":
        case "sesión": {
            return getMoodContext({ view: "session" });
        }

        case "rules":
        case "reglas": {
            if (!ruleEngine.isRunning()) {
                return "⚠️ El Rule Engine no está activo. Activa el ambient service primero.";
            }
            const rules = ruleEngine.getStatus();
            const lines = [
                `## Estado del Rule Engine`,
                ``,
                `| ID | Nombre | Habilitada | Cooldown | Último disparo |`,
                `|----|--------|-----------|----------|---------------|`,
            ];
            for (const r of rules) {
                const last = r.lastFire
                    ? `${Math.round((Date.now() - r.lastFire) / 60_000)} min atrás`
                    : "nunca";
                const cooldownMin = Math.round(r.cooldownMs / 60_000);
                lines.push(`| \`${r.id}\` | ${r.name} | ${r.enabled ? "✅" : "❌"} | ${cooldownMin} min | ${last} |`);
            }
            return lines.join("\n");
        }

        case "now":
        case "ahora": {
            const snap = moodEngine.evaluate();
            return `Estado actual: **${snap.state}** (app: ${snap.app ?? "desconocida"}, ${snap.minutesInApp} min)`;
        }

        default:
            return [
                `Subcomandos disponibles:`,
                `  \`/mood\`           — resumen del estado actual`,
                `  \`/mood patterns\`  — tabla de rutinas por hora`,
                `  \`/mood session\`   — apps usadas en esta sesión`,
                `  \`/mood rules\`     — estado de las reglas proactivas`,
            ].join("\n");
    }
}

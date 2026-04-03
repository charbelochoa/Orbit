/**
 * Orbit Command: /briefing — Sprint 10
 * ───────────────────────────────────────
 * Genera el briefing diario bajo demanda.
 *
 * Subcomandos:
 *   /briefing           → briefing matutino (por defecto)
 *   /briefing morning   → briefing matutino: clima, calendario, correo, todos
 *   /briefing evening   → digest vespertino: resumen del día, apps usadas, mañana
 *   /briefing quick     → resumen rápido: contexto actual + puntos clave
 *   /briefing calendar  → sólo calendario de hoy
 *   /briefing email     → sólo correos sin leer
 *   /briefing week      → calendario de la semana
 */

import { assembleBriefing, type BriefingType } from "../../briefing/assembler.js";
import { calendarCheck }  from "../../actions/calendar.js";
import { emailRead }      from "../../actions/email.js";
import type { CommandContext } from "../types.js";

export async function briefingCommand(ctx: CommandContext): Promise<string> {
    const sub = (ctx.subcommand || "morning").toLowerCase();

    // Subcomandos específicos (bypass assembler para respuesta rápida)
    switch (sub) {
        case "calendar":
        case "cal":
            return calendarCheck({ action: "today" });

        case "week":
            return calendarCheck({ action: "week" });

        case "tomorrow":
        case "tomorrow-cal":
            return calendarCheck({ action: "tomorrow" });

        case "email":
        case "mail":
        case "correo":
            return emailRead({ action: "unread", maxCount: 10 });

        case "morning":
        case "mañana":
        case "manana":
            ctx.sendReply({ type: "status_update", message: "Preparando briefing matutino…" });
            return assembleBriefing("morning");

        case "evening":
        case "noche":
        case "tarde":
        case "digest":
            ctx.sendReply({ type: "status_update", message: "Preparando digest del día…" });
            return assembleBriefing("evening");

        case "quick":
        case "rapido":
        case "rápido":
        case "now":
            ctx.sendReply({ type: "status_update", message: "Preparando briefing rápido…" });
            return assembleBriefing("quick");

        default: {
            // Sin subcomando o desconocido → briefing según hora del día
            const hour = new Date().getHours();
            const type: BriefingType = hour < 13 ? "morning" : hour < 20 ? "quick" : "evening";
            ctx.sendReply({ type: "status_update", message: "Preparando briefing…" });
            return assembleBriefing(type);
        }
    }
}

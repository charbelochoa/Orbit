/**
 * Orbit Briefing — Assembler (Sprint 10)
 * ──────────────────────────────────────────
 * Ensambla el Daily Briefing combinando datos en paralelo:
 *   - Clima (wttr.in — sin API key)
 *   - Calendario de hoy (Google Calendar o Outlook COM)
 *   - Correos sin leer (Gmail o Outlook COM)
 *   - Tareas pendientes (.orbit/todos.json)
 *   - Contexto ambiental (Sprint 9, si activo)
 *
 * Las fuentes fallan de forma silenciosa — el briefing siempre produce algo.
 */

import { calendarCheck }  from "../actions/calendar.js";
import { emailRead }      from "../actions/email.js";
import { weatherReport }  from "../actions/web-search.js";
import { todoRead }       from "../actions/todo-tool.js";
import { ambientService } from "../ambient/service.js";
import { getConfig }      from "../config/config.js";

export type BriefingType = "morning" | "evening" | "quick";

function timeGreeting(): string {
    const h = new Date().getHours();
    if (h < 12) return "Buenos días";
    if (h < 18) return "Buenas tardes";
    return "Buenas noches";
}

function formatNow(): string {
    return new Date().toLocaleString("es-MX", {
        weekday: "long", day: "numeric", month: "long",
        year: "numeric", hour: "2-digit", minute: "2-digit",
    });
}

/** Extrae el valor si se resolvió, o null si rechazado */
function settled<T>(r: PromiseSettledResult<T>): T | null {
    return r.status === "fulfilled" ? r.value : null;
}

// ── Assembler ─────────────────────────────────────────────────────────────────

export async function assembleBriefing(type: BriefingType = "morning"): Promise<string> {
    const cfg  = await getConfig();
    const city = (cfg as any).briefing?.city || "";

    const sections: string[] = [];
    sections.push(`# ${timeGreeting()} — ${formatNow()}\n`);

    // ── Morning / Quick ────────────────────────────────────────────────────────
    if (type === "morning" || type === "quick") {
        // Lanzar todo en paralelo para minimizar latencia
        const [weatherR, calR, emailR, todosR] = await Promise.allSettled([
            weatherReport({ city: city || "auto" }),
            calendarCheck({ action: "today" }),
            emailRead({ action: "unread", maxCount: 5 }),
            todoRead(),
        ]);

        const weather = settled(weatherR);
        const cal     = settled(calR);
        const email   = settled(emailR);
        const todos   = settled(todosR);

        // Clima
        if (weather && !weather.startsWith("No pude")) {
            sections.push(`## 🌤 Clima\n${weather}`);
        }

        // Calendario
        if (cal) {
            sections.push(cal);
        }

        // Correo
        if (email && !email.startsWith("⚠")) {
            sections.push(`## 📧 Correo\n${email}`);
        }

        // Todos pendientes
        if (todos && !todos.includes("No hay tareas")) {
            sections.push(`## ✅ Pendientes\n${todos}`);
        }

        // Contexto ambiental (quick mode)
        if (type === "quick" && ambientService.isRunning()) {
            const snap = ambientService.getSnapshot();
            if (snap.activeWindow) {
                sections.push(
                    `## 🖥 Contexto actual\n**${snap.activeWindow.app}** — "${snap.activeWindow.title.slice(0, 80)}"`
                );
            }
        }
    }

    // ── Evening digest ─────────────────────────────────────────────────────────
    if (type === "evening") {
        sections.push("## 🌙 Resumen del Día");

        const [todosR, calTomR] = await Promise.allSettled([
            todoRead(),
            calendarCheck({ action: "tomorrow" }),
        ]);

        const todos   = settled(todosR);
        const calTom  = settled(calTomR);

        if (todos) {
            sections.push(`### Tareas pendientes\n${todos}`);
        }

        // Apps usadas hoy (de ambient)
        if (ambientService.isRunning()) {
            const snap = ambientService.getSnapshot();
            if (snap.windowHistory.length > 0) {
                const apps = [...new Set(snap.windowHistory.map(w => w.app))].slice(0, 8);
                sections.push(`### Apps usadas hoy\n${apps.map(a => `  • ${a}`).join("\n")}`);
            }
        }

        // Calendario de mañana
        if (calTom) {
            sections.push(calTom);
        }

        sections.push("\n*¿Qué quieres preparar para mañana?* 🚀");
    }

    return sections.join("\n\n");
}

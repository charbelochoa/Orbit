/**
 * Orbit Tool: calendar_check — Sprint 10
 * ────────────────────────────────────────
 * Lee eventos del calendario. Fuentes (en orden de prioridad):
 *   1. Google Calendar REST API  (si GOOGLE_CALENDAR_TOKEN está en .env)
 *   2. Microsoft Outlook COM     (vía PowerShell, si Outlook está instalado)
 *   3. Mensaje de configuración amigable
 *
 * No requiere npm adicionales — usa `fetch` nativo y `execFileSync` seguro.
 */

import { execFileSync } from "child_process";
import { createLogger } from "../infra/logger.js";

const log = createLogger("calendar");

export interface CalendarCheckParams {
    action?: "today" | "tomorrow" | "week" | "next";
    /** Días adicionales para action=next (default: 3) */
    days?: number;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Codifica un script PS en base64 UTF-16LE para -EncodedCommand */
function psEncode(script: string): string {
    const buf = Buffer.allocUnsafe(script.length * 2);
    for (let i = 0; i < script.length; i++) buf.writeUInt16LE(script.charCodeAt(i), i * 2);
    return buf.toString("base64");
}

function formatDate(d: Date): string {
    return d.toLocaleDateString("es-MX", { weekday: "long", day: "numeric", month: "long" });
}

// ── Google Calendar REST API ──────────────────────────────────────────────────

interface GCalEvent {
    summary?:     string;
    start?:       { dateTime?: string; date?: string };
    end?:         { dateTime?: string; date?: string };
    location?:    string;
    description?: string;
}

async function fetchGoogleCalendar(start: Date, end: Date): Promise<string | null> {
    const token = process.env.GOOGLE_CALENDAR_TOKEN;
    if (!token) return null;

    try {
        const url = new URL("https://www.googleapis.com/calendar/v3/calendars/primary/events");
        url.searchParams.set("timeMin", start.toISOString());
        url.searchParams.set("timeMax", end.toISOString());
        url.searchParams.set("singleEvents", "true");
        url.searchParams.set("orderBy", "startTime");
        url.searchParams.set("maxResults", "20");

        const res = await fetch(url.toString(), {
            headers: { Authorization: `Bearer ${token}` },
            signal:  AbortSignal.timeout(8000),
        });
        if (!res.ok) {
            log.warn(`Google Calendar API HTTP ${res.status}`);
            return null;
        }
        const data = await res.json() as { items?: GCalEvent[] };
        const items = (data.items ?? []).filter(e => e.summary);
        if (items.length === 0) return "No hay eventos en este período.";

        return items.map(e => {
            const startDt = e.start?.dateTime ? new Date(e.start.dateTime) : null;
            const endDt   = e.end?.dateTime   ? new Date(e.end.dateTime)   : null;
            const when    = startDt
                ? startDt.toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" })
                : "Todo el día";
            const until   = endDt
                ? ` – ${endDt.toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" })}`
                : "";
            const loc     = e.location ? ` 📍 ${e.location}` : "";
            return `  • **${when}${until}** — ${e.summary}${loc}`;
        }).join("\n");
    } catch (e: any) {
        log.warn(`Google Calendar: ${e.message}`);
        return null;
    }
}

// ── Outlook COM via PowerShell ────────────────────────────────────────────────

function fetchOutlookCalendar(startDate: Date, endDate: Date): string | null {
    // Solo interpolamos timestamps numéricos (ms since epoch) — sin entrada del usuario
    const startMs = startDate.getTime();
    const endMs   = endDate.getTime();

    const script = [
        "$ErrorActionPreference = 'Stop'; try {",
        "  $o = New-Object -ComObject Outlook.Application",
        "  $ns = $o.GetNamespace('MAPI')",
        "  $cal = $ns.GetDefaultFolder(9)",
        "  $items = $cal.Items",
        "  $items.IncludeRecurrences = $true",
        "  $items.Sort('[Start]')",
        `  $s = [DateTimeOffset]::FromUnixTimeMilliseconds(${startMs}).LocalDateTime`,
        `  $e = [DateTimeOffset]::FromUnixTimeMilliseconds(${endMs}).LocalDateTime`,
        "  $f = \"[Start] >= '\" + $s.ToString('g') + \"' AND [Start] < '\" + $e.ToString('g') + \"'\"",
        "  $ev = $items.Restrict($f)",
        "  $arr = @()",
        "  foreach ($i in $ev) {",
        "    $arr += [PSCustomObject]@{",
        "      subject  = $i.Subject",
        "      start    = $i.Start.ToString('yyyy-MM-dd HH:mm')",
        "      endTime  = $i.End.ToString('HH:mm')",
        "      location = if ($i.Location) { $i.Location } else { '' }",
        "    }",
        "  }",
        "  if ($arr.Count -eq 0) { 'EMPTY' } else { $arr | ConvertTo-Json -Depth 2 -Compress }",
        "} catch { 'UNAVAILABLE' }",
    ].join("\n");

    try {
        const raw = execFileSync("powershell.exe", [
            "-NoProfile", "-NonInteractive", "-EncodedCommand", psEncode(script),
        ], { timeout: 9000, encoding: "utf-8" }).trim();

        if (!raw || raw === "UNAVAILABLE") return null;
        if (raw === "EMPTY") return "No hay eventos en este período.";

        const parsed = JSON.parse(raw) as Array<{
            subject: string; start: string; endTime: string; location: string;
        }>;
        const arr = Array.isArray(parsed) ? parsed : [parsed];
        return arr.map(ev => {
            const loc = ev.location ? ` 📍 ${ev.location}` : "";
            return `  • **${ev.start.slice(11, 16)} – ${ev.endTime}** — ${ev.subject}${loc}`;
        }).join("\n");
    } catch {
        return null;
    }
}

// ── Public API ────────────────────────────────────────────────────────────────

export async function calendarCheck(parameters: any): Promise<string> {
    const p      = (parameters ?? {}) as CalendarCheckParams;
    const action = p.action ?? "today";

    const midnight = new Date();
    midnight.setHours(0, 0, 0, 0);

    let start = new Date(midnight);
    let end   = new Date(midnight);
    let label = "";

    switch (action) {
        case "tomorrow":
            start.setDate(start.getDate() + 1);
            end.setDate(end.getDate() + 2);
            label = `mañana (${formatDate(start)})`;
            break;
        case "week":
            end.setDate(end.getDate() + 7);
            label = `los próximos 7 días`;
            break;
        case "next":
            end.setDate(end.getDate() + (p.days ?? 3));
            label = `los próximos ${p.days ?? 3} días`;
            break;
        default: // today
            end.setDate(end.getDate() + 1);
            label = `hoy (${formatDate(start)})`;
            break;
    }

    const header = `## 📅 Calendario — ${label}\n`;

    const gcal = await fetchGoogleCalendar(start, end);
    if (gcal !== null) return header + gcal;

    const outlook = fetchOutlookCalendar(start, end);
    if (outlook !== null) return header + outlook;

    return [
        header,
        "⚠ Calendario no configurado.",
        "",
        "Para activar, elige una opción:",
        "• **Google Calendar** — añade `GOOGLE_CALENDAR_TOKEN=<token>` en `.env`",
        "  Obtén el token en: https://developers.google.com/oauthplayground",
        "  Scope necesario: `https://www.googleapis.com/auth/calendar.readonly`",
        "• **Outlook** — instala Microsoft Outlook, funcionará automáticamente.",
    ].join("\n");
}

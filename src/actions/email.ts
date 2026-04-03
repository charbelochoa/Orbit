/**
 * Orbit Tool: email_read — Sprint 10
 * ─────────────────────────────────────
 * Lee el estado del correo del usuario. Fuentes (en orden de prioridad):
 *   1. Gmail REST API    (si GMAIL_ACCESS_TOKEN está en .env)
 *   2. Outlook COM       (vía PowerShell, si Outlook está instalado)
 *   3. Mensaje de configuración amigable
 *
 * No requiere npm adicionales — usa `fetch` nativo y `execFileSync` seguro.
 */

import { execFileSync } from "child_process";
import { createLogger } from "../infra/logger.js";

const log = createLogger("email");

export interface EmailReadParams {
    action?:   "unread" | "summary" | "recent";
    maxCount?: number;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function psEncode(script: string): string {
    const buf = Buffer.allocUnsafe(script.length * 2);
    for (let i = 0; i < script.length; i++) buf.writeUInt16LE(script.charCodeAt(i), i * 2);
    return buf.toString("base64");
}

// ── Gmail REST API ────────────────────────────────────────────────────────────

interface GmailMsgHeader { name: string; value: string; }
interface GmailMsg {
    id:       string;
    payload?: { headers?: GmailMsgHeader[] };
}

async function fetchGmail(maxCount: number): Promise<string | null> {
    const token = process.env.GMAIL_ACCESS_TOKEN;
    if (!token) return null;

    try {
        const listUrl = `https://gmail.googleapis.com/gmail/v1/users/me/messages?labelIds=UNREAD&maxResults=${maxCount}`;
        const listRes = await fetch(listUrl, {
            headers: { Authorization: `Bearer ${token}` },
            signal:  AbortSignal.timeout(8000),
        });
        if (!listRes.ok) {
            log.warn(`Gmail API HTTP ${listRes.status}`);
            return null;
        }
        const listData = await listRes.json() as {
            messages?: GmailMsg[];
            resultSizeEstimate?: number;
        };
        const total    = listData.resultSizeEstimate ?? 0;
        const messages = listData.messages ?? [];

        if (total === 0 || messages.length === 0) return "📭 No tienes correos sin leer.";

        // Fetch subject + from for the first 5 messages in parallel
        const previews = await Promise.all(
            messages.slice(0, Math.min(5, messages.length)).map(async (m) => {
                try {
                    const msgRes = await fetch(
                        `https://gmail.googleapis.com/gmail/v1/users/me/messages/${m.id}?format=metadata&metadataHeaders=Subject&metadataHeaders=From`,
                        { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(5000) },
                    );
                    if (!msgRes.ok) return null;
                    const msg  = await msgRes.json() as GmailMsg;
                    const hdrs = msg.payload?.headers ?? [];
                    const subj = hdrs.find(h => h.name === "Subject")?.value ?? "(sin asunto)";
                    const from = hdrs.find(h => h.name === "From")?.value ?? "";
                    const sender = from.replace(/<[^>]+>/g, "").trim() || from;
                    return `  • **${subj.slice(0, 70)}** — de ${sender.slice(0, 40)}`;
                } catch {
                    return null;
                }
            })
        );

        const shown = previews.filter(Boolean).join("\n");
        const extra = total > 5 ? `\n  _…y ${total - 5} más_` : "";
        return `📬 **${total} correos sin leer:**\n${shown}${extra}`;
    } catch (e: any) {
        log.warn(`Gmail: ${e.message}`);
        return null;
    }
}

// ── Outlook COM via PowerShell ────────────────────────────────────────────────

function fetchOutlookEmail(maxCount: number): string | null {
    // Script fijo — solo maxCount es interpolado (es un número, sin riesgo)
    const script = [
        "$ErrorActionPreference = 'Stop'; try {",
        "  $o     = New-Object -ComObject Outlook.Application",
        "  $ns    = $o.GetNamespace('MAPI')",
        "  $inbox = $ns.GetDefaultFolder(6)",
        "  $all   = $inbox.Items | Where-Object { $_.UnRead -eq $true }",
        "  $total = @($all).Count",
        `  $msgs  = @($all) | Select-Object -First ${maxCount}`,
        "  $arr   = @()",
        "  foreach ($m in $msgs) {",
        "    $arr += [PSCustomObject]@{",
        "      subject  = $m.Subject",
        "      sender   = $m.SenderName",
        "      received = $m.ReceivedTime.ToString('dd/MM HH:mm')",
        "    }",
        "  }",
        "  [PSCustomObject]@{ total = $total; items = $arr } | ConvertTo-Json -Depth 3 -Compress",
        "} catch { 'UNAVAILABLE' }",
    ].join("\n");

    try {
        const raw = execFileSync("powershell.exe", [
            "-NoProfile", "-NonInteractive", "-EncodedCommand", psEncode(script),
        ], { timeout: 9000, encoding: "utf-8" }).trim();

        if (!raw || raw === "UNAVAILABLE") return null;

        const data = JSON.parse(raw) as {
            total: number;
            items: Array<{ subject: string; sender: string; received: string }> | null;
        };
        if (data.total === 0) return "📭 No tienes correos sin leer.";

        // COM puede devolver el objeto directamente si es un solo elemento
        const items = Array.isArray(data.items)
            ? data.items
            : data.items ? [data.items] : [];

        const shown = items
            .map(m => `  • **${m.subject.slice(0, 70)}** — de ${m.sender} (${m.received})`)
            .join("\n");
        const extra = data.total > maxCount ? `\n  _…y ${data.total - maxCount} más_` : "";
        return `📬 **${data.total} correos sin leer:**\n${shown}${extra}`;
    } catch {
        return null;
    }
}

// ── Public API ────────────────────────────────────────────────────────────────

export async function emailRead(parameters: any): Promise<string> {
    const p        = (parameters ?? {}) as EmailReadParams;
    const maxCount = Math.min(p.maxCount ?? 10, 30);

    const gmail = await fetchGmail(maxCount);
    if (gmail !== null) return gmail;

    const outlook = fetchOutlookEmail(maxCount);
    if (outlook !== null) return outlook;

    return [
        "⚠ Correo no configurado.",
        "",
        "Para activar la lectura de correo:",
        "• **Gmail** — añade `GMAIL_ACCESS_TOKEN=<token>` en `.env`",
        "  Obtén el token en: https://developers.google.com/oauthplayground",
        "  Scope necesario: `https://www.googleapis.com/auth/gmail.readonly`",
        "• **Outlook** — instala Microsoft Outlook, funcionará automáticamente.",
    ].join("\n");
}

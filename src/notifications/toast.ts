/**
 * Orbit Notifications — Toast Sender (Sprint 12)
 * ─────────────────────────────────────────────────
 * Envía notificaciones nativas al sistema operativo.
 *
 * Estrategia:
 *  1. Broadcast WS {type: "notify_toast"} → Electron usa new Notification() (principal)
 *  2. Fallback CLI — PowerShell Windows.UI.Notifications (cuando no hay Electron)
 *
 * No requiere paquetes npm adicionales.
 */

import { execFileSync } from "child_process";
import { createLogger } from "../infra/logger.js";
import { broadcast }    from "../gateway/server.js";
import type { ToastPayload } from "./types.js";

const log = createLogger("notify");

/** Clientes Electron actualmente conectados (detectado por broadcast success) */
let _electronConnected = false;
export function setElectronConnected(connected: boolean): void {
    _electronConnected = connected;
}

/**
 * Envía una notificación toast.
 * Si Electron está conectado → broadcast + Electron native Notification.
 * Si no → PowerShell BalloonTip (sólo Windows).
 */
export function sendToast(payload: ToastPayload): void {
    log.debug(`Toast [${payload.category ?? "info"}]: ${payload.title} — ${payload.body}`);

    // Siempre broadcast para que Electron lo intercepte
    broadcast({
        type:     "notify_toast",
        title:    payload.title,
        body:     payload.body,
        category: payload.category ?? "info",
        sourceId: payload.sourceId ?? "",
        silent:   payload.silent ?? false,
    });

    // Fallback para modo CLI (sin Electron): PowerShell balloon
    if (!_electronConnected && process.platform === "win32") {
        _sendPsBalloon(payload);
    }
}

// ── PowerShell fallback ───────────────────────────────────────────────────────

function _sendPsBalloon(payload: ToastPayload): void {
    const title = _sanitize(payload.title);
    const body  = _sanitize(payload.body);
    const script = [
        "Add-Type -AssemblyName System.Windows.Forms",
        "$ico = [System.Drawing.SystemIcons]::Information",
        "$n = New-Object System.Windows.Forms.NotifyIcon",
        "$n.Icon = $ico",
        "$n.Visible = $true",
        `$n.ShowBalloonTip(5000, '${title}', '${body}', [System.Windows.Forms.ToolTipIcon]::Info)`,
        "Start-Sleep -Milliseconds 5500",
        "$n.Dispose()",
    ].join("; ");

    const encoded = Buffer.from(script, "utf16le").toString("base64");
    try {
        execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-EncodedCommand", encoded], {
            timeout: 7000,
            windowsHide: true,
        });
    } catch {
        // Silencioso: PS no disponible o sin pantalla
    }
}

function _sanitize(s: string): string {
    return s.replace(/'/g, "").replace(/[\r\n]/g, " ").slice(0, 120);
}

/**
 * Orbit Ambient — Clipboard Monitor (Sprint 9, Windows only)
 * ──────────────────────────────────────────────────────────
 * Observa el portapapeles cada N ms.  Cuando detecta contenido nuevo y
 * relevante (URL, error, código) emite un evento ambient_clipboard para
 * que el motor de Orbit pueda reaccionar proactivamente.
 *
 * Seguridad: usa execFileSync sin shell (args array), sin interpolación de
 * entrada del usuario. Get-Clipboard no acepta parámetros de usuario.
 */

import { execFileSync }  from "child_process";
import { createLogger }  from "../infra/logger.js";
import { broadcast }     from "../gateway/server.js";
import type { ClipboardEntry, ClipboardContentType } from "./types.js";

const log = createLogger("ambient");

/** Infiere el tipo de contenido del portapapeles */
function classifyClipboard(text: string): ClipboardContentType {
    const t = text.trim();
    // URL
    if (/^https?:\/\/\S+$/i.test(t)) return "url";
    // Stack trace / error message
    if (/\b(Error|Exception|Traceback|at line \d|undefined is not|cannot read|null reference|segmentation fault)\b/i.test(t)) return "error";
    // Código: múltiples líneas + keywords de lenguajes comunes
    if (/\n/.test(t) && /[{};()=>]|\b(def |class |function |import |require |export |const |var |let )\b/.test(t)) return "code";
    return "text";
}

export interface ClipboardMonitorConfig {
    pollIntervalMs: number;
    minLength:      number;
    maxLength:      number;
    notifyOnUrl:    boolean;
    notifyOnCode:   boolean;
    notifyOnError:  boolean;
}

export class ClipboardMonitor {
    private _intervalId: ReturnType<typeof setInterval> | null = null;
    private _lastText = "";
    private _current:  ClipboardEntry | null = null;
    private readonly _cfg: ClipboardMonitorConfig;

    constructor(cfg: ClipboardMonitorConfig) {
        this._cfg = cfg;
    }

    start(): void {
        if (this._intervalId) return;
        this._intervalId = setInterval(() => this._poll(), this._cfg.pollIntervalMs);
        log.debug(`ClipboardMonitor iniciado (poll: ${this._cfg.pollIntervalMs}ms)`);
    }

    stop(): void {
        if (this._intervalId) {
            clearInterval(this._intervalId);
            this._intervalId = null;
        }
    }

    getCurrent(): ClipboardEntry | null { return this._current; }

    private _poll(): void {
        try {
            const raw = execFileSync("powershell.exe", [
                "-NoProfile", "-NonInteractive", "-Command", "Get-Clipboard",
            ], { timeout: 2500, encoding: "utf-8" });

            // trimEnd preserva indentación/formato de código
            const text = raw.trimEnd();
            if (!text || text === this._lastText) return;
            if (text.length < this._cfg.minLength)  return;

            this._lastText = text;
            const trimmed = text.slice(0, this._cfg.maxLength);
            const type    = classifyClipboard(trimmed);

            this._current = { text: trimmed, type, ts: Date.now() };

            const shouldNotify =
                (type === "url"   && this._cfg.notifyOnUrl)   ||
                (type === "code"  && this._cfg.notifyOnCode)   ||
                (type === "error" && this._cfg.notifyOnError);

            if (shouldNotify) {
                log.debug(`Clipboard [${type}]: ${trimmed.slice(0, 80).replace(/\n/g, " ")}`);
                broadcast({
                    type:        "ambient_clipboard",
                    contentType: type,
                    preview:     trimmed.slice(0, 200),
                    ts:          this._current.ts,
                });
            }
        } catch {
            // Silencioso: portapapeles no disponible, vacío, timeout
        }
    }
}

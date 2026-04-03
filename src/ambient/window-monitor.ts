/**
 * Orbit Ambient — Window Monitor (Sprint 9, Windows only)
 * ─────────────────────────────────────────────────────────
 * Detecta la ventana en primer plano cada N ms usando un comando PowerShell
 * interno (sin entrada de usuario — cadena fija, sin riesgo de inyección).
 *
 * Heurística: proceso con mayor Working Set que tenga MainWindowTitle visible.
 * Funciona bien para las apps cotidianas: VS Code, Chrome, Discord, Explorer…
 */

import { execFileSync } from "child_process";
import { createLogger } from "../infra/logger.js";
import { broadcast }    from "../gateway/server.js";
import type { WindowSnapshot } from "./types.js";

const log = createLogger("ambient");

// Comando PS interno fijo — no contiene entrada del usuario.
const WINDOW_PS_CMD = [
    "$p = Get-Process",
    "  | Where-Object { $_.MainWindowHandle -ne 0 -and $_.MainWindowTitle -ne '' }",
    "  | Sort-Object WS -Descending",
    "  | Select-Object -First 1 ProcessName, MainWindowTitle;",
    "if ($p) {",
    "  [pscustomobject]@{ app = $p.ProcessName; title = $p.MainWindowTitle } | ConvertTo-Json -Compress",
    "} else { '{\"app\":\"unknown\",\"title\":\"\"}' }",
].join(" ");

export interface WindowMonitorConfig {
    pollIntervalMs: number;
    historySize:    number;
}

export class WindowMonitor {
    private _intervalId: ReturnType<typeof setInterval> | null = null;
    private _current:    WindowSnapshot | null = null;
    private _history:    WindowSnapshot[] = [];
    private readonly _cfg: WindowMonitorConfig;

    constructor(cfg: WindowMonitorConfig) {
        this._cfg = cfg;
    }

    start(): void {
        if (this._intervalId) return;
        // Primera captura inmediata, luego polling
        this._poll();
        this._intervalId = setInterval(() => this._poll(), this._cfg.pollIntervalMs);
        log.debug(`WindowMonitor iniciado (poll: ${this._cfg.pollIntervalMs}ms)`);
    }

    stop(): void {
        if (this._intervalId) {
            clearInterval(this._intervalId);
            this._intervalId = null;
        }
    }

    getCurrent(): WindowSnapshot | null { return this._current; }
    getHistory(): WindowSnapshot[]      { return [...this._history]; }

    private _poll(): void {
        try {
            const raw = execFileSync("powershell.exe", [
                "-NoProfile", "-NonInteractive", "-Command", WINDOW_PS_CMD,
            ], { timeout: 4000, encoding: "utf-8" }).trim();

            if (!raw) return;
            const data = JSON.parse(raw) as { app?: string; title?: string };
            if (!data.app || data.app === "unknown") return;

            const snap: WindowSnapshot = {
                app:   data.app,
                title: (data.title ?? "").slice(0, 200),
                ts:    Date.now(),
            };

            // Sólo emitir evento si la ventana realmente cambió
            if (this._current?.app !== snap.app || this._current?.title !== snap.title) {
                const prev = this._current;
                this._current = snap;
                this._history.unshift(snap);
                if (this._history.length > this._cfg.historySize) {
                    this._history.length = this._cfg.historySize;
                }
                log.debug(`Ventana activa: ${snap.app} — "${snap.title.slice(0, 60)}"`);
                broadcast({
                    type:     "ambient_window_change",
                    app:      snap.app,
                    title:    snap.title,
                    previous: prev?.app ?? null,
                    ts:       snap.ts,
                });
            }
        } catch {
            // Ignorar silenciosamente: PS no disponible, timeout, proceso sin título
        }
    }
}

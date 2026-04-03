/**
 * Orbit Ambient Awareness Service — Sprint 9
 * ────────────────────────────────────────────
 * Orquestador del motor de percepción ambiental.
 * Arranca/detiene WindowMonitor, ClipboardMonitor y DownloadWatcher
 * según la configuración en orbit.yaml (ambient.enabled).
 *
 * Expone `getSnapshot()` para la tool get_ambient_context y el comando /ambient.
 */

import { createLogger }     from "../infra/logger.js";
import { getConfig, onConfigRefresh } from "../config/config.js";
import { WindowMonitor,   type WindowMonitorConfig   } from "./window-monitor.js";
import { ClipboardMonitor, type ClipboardMonitorConfig } from "./clipboard-monitor.js";
import { DownloadWatcher,  type DownloadWatcherConfig  } from "./download-watcher.js";
import { patternLearner }  from "./pattern-learner.js";
import type { AmbientSnapshot } from "./types.js";

const log = createLogger("ambient");

class AmbientService {
    private _running          = false;
    private _windowMonitor:    WindowMonitor   | null = null;
    private _clipboardMonitor: ClipboardMonitor | null = null;
    private _downloadWatcher:  DownloadWatcher  | null = null;
    /** Intervalo que alimenta el PatternLearner cada 5 s */
    private _patternTimer: ReturnType<typeof setInterval> | null = null;

    async start(): Promise<void> {
        if (this._running) return;

        const cfg = await getConfig();
        if (!cfg.ambient?.enabled) {
            log.debug("Ambient service deshabilitado en config (ambient.enabled: false)");
            return;
        }

        this._running = true;
        const ac = cfg.ambient;

        // ── Window Monitor ─────────────────────────────────────────
        if (ac.window?.enabled !== false && process.platform === "win32") {
            const wmCfg: WindowMonitorConfig = {
                pollIntervalMs: ac.window?.pollIntervalMs ?? 5000,
                historySize:    ac.window?.historySize    ?? 10,
            };
            this._windowMonitor = new WindowMonitor(wmCfg);
            this._windowMonitor.start();
        }

        // ── Clipboard Monitor ──────────────────────────────────────
        if (ac.clipboard?.enabled !== false && process.platform === "win32") {
            const cbCfg: ClipboardMonitorConfig = {
                pollIntervalMs: ac.clipboard?.pollIntervalMs ?? 2000,
                minLength:      ac.clipboard?.minLength      ?? 3,
                maxLength:      ac.clipboard?.maxLength      ?? 5000,
                notifyOnUrl:    ac.clipboard?.notifyOnUrl    ?? true,
                notifyOnCode:   ac.clipboard?.notifyOnCode   ?? false,
                notifyOnError:  ac.clipboard?.notifyOnError  ?? true,
            };
            this._clipboardMonitor = new ClipboardMonitor(cbCfg);
            this._clipboardMonitor.start();
        }

        // ── Download Watcher ───────────────────────────────────────
        if (ac.downloads?.enabled !== false) {
            const dlCfg: DownloadWatcherConfig = {
                notifyOnNew:     ac.downloads?.notifyOnNew     ?? true,
                watchExtensions: ac.downloads?.watchExtensions ?? [
                    "pdf", "zip", "exe", "docx", "xlsx", "pptx", "mp4", "mp3", "png", "jpg", "jpeg",
                ],
            };
            this._downloadWatcher = new DownloadWatcher(dlCfg);
            this._downloadWatcher.start();
        }

        log.info("Ambient Awareness Engine iniciado ✓");

        // ── PatternLearner — alimentado cada 5 s desde ventana activa ──────
        this._patternTimer = setInterval(() => {
            const current = this._windowMonitor?.getCurrent();
            if (current) patternLearner.record(current);
        }, 5000);

        // Hot-reload: detener si se deshabilita en config
        onConfigRefresh(async (newCfg) => {
            if (!newCfg.ambient?.enabled && this._running) {
                log.info("Config recargado — ambient deshabilitado, deteniendo servicio");
                await this.stop();
            }
        });
    }

    async stop(): Promise<void> {
        if (!this._running) return;
        this._running = false;

        if (this._patternTimer) { clearInterval(this._patternTimer); this._patternTimer = null; }
        patternLearner.flushAndSave();

        this._windowMonitor?.stop();
        this._clipboardMonitor?.stop();
        await this._downloadWatcher?.stop();

        this._windowMonitor    = null;
        this._clipboardMonitor = null;
        this._downloadWatcher  = null;

        log.info("Ambient service detenido");
    }

    isRunning(): boolean { return this._running; }

    getSnapshot(): AmbientSnapshot {
        const history = this._windowMonitor?.getHistory() ?? [];
        return {
            activeWindow:    this._windowMonitor?.getCurrent()    ?? null,
            previousWindow:  history[1]                           ?? null,
            windowHistory:   history,
            recentClipboard: this._clipboardMonitor?.getCurrent() ?? null,
            recentDownloads: this._downloadWatcher?.getRecent()   ?? [],
            lastUpdated:     Date.now(),
        };
    }
}

/** Singleton del servicio — importar en index.ts y en la tool */
export const ambientService = new AmbientService();

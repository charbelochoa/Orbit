/**
 * Orbit Ambient — Download Watcher (Sprint 9)
 * ─────────────────────────────────────────────
 * Observa la carpeta Downloads del OS usando chokidar (ya en deps desde Sprint 5).
 * Emite un evento ambient_download cuando aparece un archivo nuevo e interesante.
 *
 * - Ignora descargas parciales (.crdownload, .part, .tmp)
 * - Espera a que el archivo esté estable antes de emitir (awaitWriteFinish)
 * - Sólo notifica extensiones configuradas en orbit.yaml
 */

import chokidar, { type FSWatcher } from "chokidar";
import path from "path";
import os   from "os";
import { createLogger } from "../infra/logger.js";
import { broadcast }    from "../gateway/server.js";
import type { DownloadEvent } from "./types.js";

const log = createLogger("ambient");

const DOWNLOADS_DIR = path.join(os.homedir(), "Downloads");

export interface DownloadWatcherConfig {
    notifyOnNew:     boolean;
    watchExtensions: string[];  // sin punto, minúsculas  ej: ["pdf","zip"]
}

export class DownloadWatcher {
    private _watcher: FSWatcher | null = null;
    private _recent:  DownloadEvent[]  = [];
    private readonly _cfg: DownloadWatcherConfig;

    constructor(cfg: DownloadWatcherConfig) {
        this._cfg = cfg;
    }

    start(): void {
        if (this._watcher) return;

        this._watcher = chokidar.watch(DOWNLOADS_DIR, {
            persistent:    false,  // no bloquea el cierre del proceso
            ignoreInitial: true,   // no disparar para archivos ya existentes
            depth:         0,      // sólo nivel raíz de Downloads
            awaitWriteFinish: {
                stabilityThreshold: 1500,
                pollInterval:       300,
            },
            ignored: [
                /\.crdownload$/i,   // Chrome descarga parcial
                /\.part$/i,         // Firefox descarga parcial
                /\.tmp$/i,          // temp genérico
                /\.download$/i,     // Safari
            ],
        });

        this._watcher.on("add", (filePath) => {
            const basename = path.basename(filePath);
            const ext      = path.extname(basename).replace(".", "").toLowerCase();

            // Filtrar por extensiones configuradas (array vacío = aceptar todo)
            if (this._cfg.watchExtensions.length > 0 &&
                !this._cfg.watchExtensions.includes(ext)) return;

            const evt: DownloadEvent = { file: basename, ext, ts: Date.now() };
            this._recent.unshift(evt);
            if (this._recent.length > 5) this._recent.length = 5;

            log.info(`Nueva descarga detectada: ${basename}`);

            if (this._cfg.notifyOnNew) {
                broadcast({
                    type: "ambient_download",
                    file: basename,
                    ext,
                    ts:   evt.ts,
                });
            }
        });

        this._watcher.on("error", (err) => {
            log.warn(`DownloadWatcher error: ${(err as Error).message}`);
        });

        log.debug(`DownloadWatcher iniciado: ${DOWNLOADS_DIR}`);
    }

    async stop(): Promise<void> {
        if (this._watcher) {
            await this._watcher.close();
            this._watcher = null;
        }
    }

    getRecent(): DownloadEvent[] { return [...this._recent]; }
}

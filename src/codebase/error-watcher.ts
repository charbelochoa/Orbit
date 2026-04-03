/**
 * Orbit Codebase — TypeScript/Build Error Watcher (Sprint 13)
 * ──────────────────────────────────────────────────────────────
 * Observa los archivos .ts del proyecto. Cuando detecta un cambio
 * (vía chokidar), ejecuta `tsc --noEmit` en background (debounced,
 * máximo cada 30 s) y parsea la salida para extraer errores.
 *
 * Cuando la lista de errores cambia:
 *   • Emite broadcast {type: "codebase_errors_changed", added, resolved, errors}
 *   • NotificationService (Sprint 12) convierte eso en un toast si hay errores nuevos
 *
 * No depende de tsc instalado globalmente — usa `npx tsc` desde el cwd del proyecto.
 */

import { execFile }  from "child_process";
import path          from "path";
import { fileURLToPath } from "url";
import chokidar, { type FSWatcher } from "chokidar";
import { createLogger } from "../infra/logger.js";
import { getConfig }    from "../config/config.js";
import { broadcast }    from "../gateway/server.js";

const log       = createLogger("codebase");
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT      = path.join(__dirname, "../..");

// ── Types ─────────────────────────────────────────────────────────────────────

export interface TsError {
    file:    string;
    line:    number;
    col:     number;
    code:    string;   // e.g. "TS2304"
    message: string;
    severity: "error" | "warning";
}

// ── Parse tsc output ──────────────────────────────────────────────────────────

// Matches: "src/foo.ts(12,5): error TS2304: Cannot find name 'bar'."
const TSC_LINE_RE = /^(.+?)\((\d+),(\d+)\): (error|warning) (TS\d+): (.+)$/;

function parseTscOutput(raw: string): TsError[] {
    return raw
        .split("\n")
        .map(line => {
            const m = TSC_LINE_RE.exec(line.trim());
            if (!m) return null;
            return {
                file:     m[1].replace(/\\/g, "/"),
                line:     parseInt(m[2], 10),
                col:      parseInt(m[3], 10),
                severity: m[4] as "error" | "warning",
                code:     m[5],
                message:  m[6],
            } satisfies TsError;
        })
        .filter((e): e is TsError => e !== null);
}

// ── Error key for diff ────────────────────────────────────────────────────────

function errKey(e: TsError): string {
    return `${e.file}:${e.line}:${e.col}:${e.code}`;
}

// ── Watcher ───────────────────────────────────────────────────────────────────

export class ErrorWatcher {
    private _running  = false;
    private _watcher: FSWatcher | null = null;
    private _debounce: ReturnType<typeof setTimeout> | null = null;
    private _lastRun  = 0;
    private _errors:  Map<string, TsError> = new Map();
    private _running_tsc = false;
    private _minIntervalMs = 30_000; // máximo 1 compilación / 30 s

    start(): void {
        if (this._running) return;
        const cfg = getConfig();
        if (!cfg.codebase?.errorWatcher?.enabled) {
            log.debug("Error watcher deshabilitado (codebase.errorWatcher.enabled: false)");
            return;
        }

        this._running = true;
        this._minIntervalMs = (cfg.codebase.errorWatcher.minIntervalSec ?? 30) * 1000;

        const root = cfg.codebase.root || ROOT;

        this._watcher = chokidar.watch("**/*.ts", {
            cwd:           root,
            ignored:       ["**/node_modules/**", "**/dist/**", "**/.git/**"],
            persistent:    true,
            ignoreInitial: true,
            awaitWriteFinish: { stabilityThreshold: 800, pollInterval: 200 },
        });

        this._watcher.on("change", () => this._schedule());
        this._watcher.on("add",    () => this._schedule());
        this._watcher.on("unlink", () => this._schedule());

        log.info(`Error watcher iniciado (intervalo mínimo: ${this._minIntervalMs / 1000}s)`);

        // Primera ejecución al arrancar (diferida 5 s para no bloquear)
        setTimeout(() => this._runTsc(), 5000);
    }

    stop(): void {
        if (!this._running) return;
        this._running = false;
        if (this._debounce) { clearTimeout(this._debounce); this._debounce = null; }
        this._watcher?.close();
        this._watcher = null;
        log.info("Error watcher detenido");
    }

    isRunning(): boolean { return this._running; }

    getErrors(): TsError[] { return [...this._errors.values()]; }

    getErrorCount(): number { return this._errors.size; }

    // ── Privado ───────────────────────────────────────────────────────────────

    private _schedule(): void {
        if (this._debounce) clearTimeout(this._debounce);
        this._debounce = setTimeout(() => {
            this._debounce = null;
            const elapsed = Date.now() - this._lastRun;
            if (elapsed >= this._minIntervalMs) {
                this._runTsc();
            }
        }, 2000); // 2 s de debounce
    }

    private _runTsc(): void {
        if (!this._running || this._running_tsc) return;
        this._running_tsc = true;
        this._lastRun = Date.now();

        const cfg  = getConfig();
        const root = cfg.codebase?.root || ROOT;
        const npx  = process.platform === "win32" ? "npx.cmd" : "npx";

        log.debug("Ejecutando tsc --noEmit...");

        execFile(npx, ["tsc", "--noEmit"], {
            cwd:          root,
            timeout:      60_000,
            windowsHide:  true,
            maxBuffer:    1024 * 1024, // 1 MB
        }, (_err, stdout, stderr) => {
            this._running_tsc = false;
            if (!this._running) return;

            const raw    = (stdout || "") + (stderr || "");
            const fresh  = parseTscOutput(raw);
            this._diff(fresh);
        });
    }

    private _diff(freshErrors: TsError[]): void {
        const freshMap = new Map<string, TsError>(freshErrors.map(e => [errKey(e), e]));

        const added:    TsError[] = [];
        const resolved: TsError[] = [];

        // Errores nuevos
        for (const [k, e] of freshMap) {
            if (!this._errors.has(k)) added.push(e);
        }
        // Errores resueltos
        for (const [k, e] of this._errors) {
            if (!freshMap.has(k)) resolved.push(e);
        }

        this._errors = freshMap;

        if (added.length === 0 && resolved.length === 0) return; // sin cambios

        log.info(`Errores TS — nuevos: ${added.length}, resueltos: ${resolved.length}, total: ${this._errors.size}`);

        broadcast({
            type:     "codebase_errors_changed",
            added:    added.length,
            resolved: resolved.length,
            total:    this._errors.size,
            errors:   freshErrors.slice(0, 20).map(e => ({
                file:    e.file,
                line:    e.line,
                code:    e.code,
                message: e.message.slice(0, 100),
            })),
        });
    }
}

/** Singleton */
export const errorWatcher = new ErrorWatcher();

/**
 * Orbit Codebase — Semantic Indexer (Sprint 13)
 * ───────────────────────────────────────────────
 * Indexa los archivos fuente del proyecto en una base de datos vectorial
 * separada (data/codebase.db) usando el motor VectorMemoryStore ya existente.
 *
 * Flujo:
 *  1. En arranque → indexa todos los archivos que coincidan con las extensiones
 *     configuradas (por defecto: .ts, .tsx, .js, .py, .md).
 *  2. chokidar vigila cambios → re-indexa sólo el archivo modificado (debounced).
 *  3. La tool `codebase_search` consulta este store.
 *
 * Prefijo de ruta en la DB: "codebase:<ruta-relativa>" para distinguir de
 * la memoria personal (data/memory.db).
 */

import fs       from "fs";
import path     from "path";
import { fileURLToPath } from "url";
import chokidar, { type FSWatcher } from "chokidar";
import { createLogger }     from "../infra/logger.js";
import { getConfig }        from "../config/config.js";
import { VectorMemoryStore, type MemorySearchResult } from "../memory/vector-store.js";

const log = createLogger("codebase");
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH   = path.join(__dirname, "../../data/codebase.db");

// ── Types ─────────────────────────────────────────────────────────────────────

export interface IndexStats {
    files:      number;
    chunks:     number;
    embeddings: number;
    running:    boolean;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const DEFAULT_EXTENSIONS = [".ts", ".tsx", ".js", ".mjs", ".cjs", ".py", ".md"];
const DEFAULT_EXCLUDES   = [
    "**/node_modules/**",
    "**/dist/**",
    "**/.git/**",
    "**/coverage/**",
    "**/*.min.js",
    "**/*.map",
    "**/*.lock",
    "**/data/**",
];

/** Convierte una ruta absoluta en la clave `codebase:<relativa>` */
function toKey(absolutePath: string, root: string): string {
    const rel = path.relative(root, absolutePath).replace(/\\/g, "/");
    return `codebase:${rel}`;
}

// ── Indexer ───────────────────────────────────────────────────────────────────

export class CodebaseIndexer {
    private _store: VectorMemoryStore | null = null;
    private _watcher: FSWatcher | null = null;
    private _running  = false;
    private _root     = "";
    /** Debounce timers por archivo */
    private _timers: Map<string, ReturnType<typeof setTimeout>> = new Map();
    private _stats = { files: 0, chunks: 0 };

    async start(): Promise<void> {
        if (this._running) return;

        const cfg = getConfig();
        if (!cfg.codebase?.enabled) {
            log.debug("Codebase indexer deshabilitado (codebase.enabled: false)");
            return;
        }

        this._running = true;
        this._root    = cfg.codebase.root || process.cwd();
        const exts    = cfg.codebase.extensions ?? DEFAULT_EXTENSIONS;
        const excludes = [
            ...DEFAULT_EXCLUDES,
            ...(cfg.codebase.excludePatterns ?? []),
        ];

        // Abre (o crea) la DB de codebase
        this._store = new VectorMemoryStore(DB_PATH);

        log.info(`Codebase indexer iniciado — root: ${this._root}`);

        // Índice inicial en background (no bloquea el arranque)
        this._indexAll(exts, excludes).catch(e => log.warn(`Index inicial falló: ${e.message}`));

        // Watch incremental con chokidar
        const globPattern = exts.map(e => `**/*${e}`);
        this._watcher = chokidar.watch(globPattern, {
            cwd:           this._root,
            ignored:       excludes,
            persistent:    true,
            ignoreInitial: true, // el índice inicial ya cubre esto
            awaitWriteFinish: { stabilityThreshold: 600, pollInterval: 100 },
        });

        this._watcher.on("add",    (f: string) => this._scheduleIndex(path.join(this._root, f)));
        this._watcher.on("change", (f: string) => this._scheduleIndex(path.join(this._root, f)));
        this._watcher.on("unlink", (f: string) => this._removeFile(path.join(this._root, f)));
        this._watcher.on("error",  (e: unknown) => log.warn(`Watcher error: ${e}`));
    }

    async stop(): Promise<void> {
        if (!this._running) return;
        this._running = false;

        for (const t of this._timers.values()) clearTimeout(t);
        this._timers.clear();

        await this._watcher?.close();
        this._watcher = null;

        this._store?.close();
        this._store = null;
        log.info("Codebase indexer detenido");
    }

    isRunning(): boolean { return this._running; }

    /** Búsqueda semántica en el índice del codebase. */
    async search(query: string, topK = 6): Promise<MemorySearchResult[]> {
        if (!this._store) return [];
        return this._store.search(query, topK);
    }

    /** Fuerza un re-índice completo de todos los archivos. */
    async reindexAll(): Promise<void> {
        if (!this._store || !this._running) return;
        const cfg      = getConfig();
        const exts     = cfg.codebase?.extensions ?? DEFAULT_EXTENSIONS;
        const excludes = [...DEFAULT_EXCLUDES, ...(cfg.codebase?.excludePatterns ?? [])];
        await this._indexAll(exts, excludes);
    }

    getStats(): IndexStats {
        const raw = this._store?.stats() ?? { files: 0, chunks: 0, embeddings: 0, hasVectorSearch: false };
        return { files: raw.files, chunks: raw.chunks, embeddings: raw.embeddings, running: this._running };
    }

    // ── Privado ───────────────────────────────────────────────────────────────

    private _scheduleIndex(absPath: string): void {
        const prev = this._timers.get(absPath);
        if (prev) clearTimeout(prev);
        const t = setTimeout(() => {
            this._timers.delete(absPath);
            this._indexFile(absPath).catch(e => log.warn(`Re-index error ${absPath}: ${e.message}`));
        }, 1200);
        this._timers.set(absPath, t);
    }

    private _removeFile(absPath: string): void {
        const key = toKey(absPath, this._root);
        // VectorMemoryStore doesn't expose a direct delete-by-path — we re-index with empty
        // which skips (no content). Instead, we simply leave the stale entry; next full
        // index pass will skip it due to missing file. For now just log.
        log.debug(`Archivo eliminado del watch: ${key}`);
    }

    private async _indexFile(absPath: string): Promise<void> {
        if (!this._store) return;
        try {
            const content = fs.readFileSync(absPath, "utf-8");
            const key     = toKey(absPath, this._root);
            const chunks  = await this._store.index(key, content);
            if (chunks > 0) log.debug(`Indexado: ${key} (${chunks} chunks)`);
        } catch {
            // Archivo binario, no legible, etc.
        }
    }

    private async _indexAll(exts: string[], excludes: string[]): Promise<void> {
        if (!this._store) return;
        const allFiles = this._collectFiles(this._root, exts, excludes);
        log.info(`Indexando ${allFiles.length} archivos del codebase...`);

        let done = 0;
        for (const absPath of allFiles) {
            await this._indexFile(absPath);
            done++;
            if (done % 50 === 0) log.info(`  ${done}/${allFiles.length} archivos indexados`);
        }

        const s = this._store.stats();
        this._stats = { files: s.files, chunks: s.chunks };
        log.info(`Índice inicial completo: ${s.files} archivos, ${s.chunks} chunks, ${s.embeddings} embeddings`);
    }

    private _collectFiles(dir: string, exts: string[], excludes: string[]): string[] {
        const results: string[] = [];
        const extSet = new Set(exts);

        const isExcluded = (p: string): boolean => {
            const rel = path.relative(this._root, p).replace(/\\/g, "/");
            return excludes.some(pat => {
                if (pat.includes("**")) {
                    // Glob básico: convierte ** a regex
                    const rx = new RegExp(pat.replace(/\*\*/g, ".*").replace(/\*/g, "[^/]*").replace(/\//g, "\\/"));
                    return rx.test(rel) || rx.test(rel + "/");
                }
                return rel.startsWith(pat.replace(/\//g, path.sep));
            });
        };

        const recurse = (current: string): void => {
            if (isExcluded(current)) return;
            let entries: string[];
            try { entries = fs.readdirSync(current); } catch { return; }
            for (const entry of entries) {
                const full = path.join(current, entry);
                let stat: fs.Stats;
                try { stat = fs.statSync(full); } catch { continue; }
                if (stat.isDirectory()) {
                    recurse(full);
                } else if (extSet.has(path.extname(full))) {
                    if (!isExcluded(full)) results.push(full);
                }
            }
        };

        recurse(dir);
        return results;
    }
}

/** Singleton */
export const codebaseIndexer = new CodebaseIndexer();

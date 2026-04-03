/**
 * Orbit Proactive Watcher — Sprint 5
 * File-system trigger engine using chokidar.
 * Watches glob patterns and fires AgentExecutor goals on file events.
 *
 * Features:
 * - Per-trigger debounce (avoids storms on rapid saves)
 * - {{file}} and {{event}} template substitution in goal strings
 * - Ignore patterns (node_modules, dist, etc.)
 * - Healthy/error status per watcher for /status reporting
 */

import chokidar, { type FSWatcher } from "chokidar";
import { createLogger } from "../infra/logger.js";
import { getQueue } from "../agent/task-queue.js";
import type { OrbitConfig } from "../config/schema.js";

const log = createLogger("proactive");

type WatcherConfig = NonNullable<OrbitConfig["proactive"]>["watchers"][number];
type FsEvent = "add" | "change" | "unlink";

interface WatcherHandle {
    config:   WatcherConfig;
    watcher:  FSWatcher;
    status:   "active" | "error";
    fired:    number;
    lastFire: Date | null;
    error?:   string;
}

const handles = new Map<string, WatcherHandle>();
const debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Start all enabled watchers from config.
 */
export function startWatchers(cfg: OrbitConfig["proactive"]): void {
    if (!cfg.enabled) return;

    for (const wConfig of cfg.watchers) {
        if (!wConfig.enabled) continue;
        if (handles.has(wConfig.id)) continue; // already running
        _startWatcher(wConfig);
    }

    log.info(`File watchers activos: ${handles.size}`);
}

/**
 * Stop all watchers gracefully.
 */
export async function stopWatchers(): Promise<void> {
    // Cancel pending debounces
    for (const timer of debounceTimers.values()) clearTimeout(timer);
    debounceTimers.clear();

    const closers = Array.from(handles.values()).map(h => h.watcher.close());
    await Promise.all(closers);
    handles.clear();
    log.info("File watchers detenidos");
}

/**
 * Stop and restart a specific watcher by ID.
 */
export async function restartWatcher(id: string, newConfig: WatcherConfig): Promise<void> {
    const h = handles.get(id);
    if (h) {
        await h.watcher.close();
        handles.delete(id);
    }
    if (newConfig.enabled) {
        _startWatcher(newConfig);
    }
}

/**
 * Get status of all active watchers.
 */
export function getWatcherStats(): Array<{
    id: string;
    status: "active" | "error";
    fired: number;
    lastFire: Date | null;
    error?: string;
}> {
    return Array.from(handles.values()).map(h => ({
        id:       h.config.id,
        status:   h.status,
        fired:    h.fired,
        lastFire: h.lastFire,
        error:    h.error,
    }));
}

// ── Internal ──────────────────────────────────────────────────────────────────

function _startWatcher(wConfig: WatcherConfig): void {
    const globs = Array.isArray(wConfig.glob) ? wConfig.glob : [wConfig.glob];
    const allowedEvents = new Set<string>(wConfig.on);

    try {
        const watcher = chokidar.watch(globs, {
            persistent:        true,
            ignoreInitial:     true,
            ignored:           wConfig.ignore.length ? wConfig.ignore : ["**/node_modules/**", "**/.git/**"],
            awaitWriteFinish:  { stabilityThreshold: 200, pollInterval: 100 },
        });

        const handle: WatcherHandle = {
            config:   wConfig,
            watcher,
            status:   "active",
            fired:    0,
            lastFire: null,
        };
        handles.set(wConfig.id, handle);

        const onEvent = (event: FsEvent, filePath: string) => {
            if (!allowedEvents.has(event)) return;
            _debounce(wConfig, handle, event, filePath);
        };

        watcher.on("add",    p => onEvent("add", p));
        watcher.on("change", p => onEvent("change", p));
        watcher.on("unlink", p => onEvent("unlink", p));
        watcher.on("error",  e => {
            handle.status = "error";
            handle.error  = String(e);
            log.warn(`Watcher '${wConfig.id}' error: ${e}`);
        });

        log.debug(`Watcher '${wConfig.id}' observando: ${globs.join(", ")}`);
    } catch (e: any) {
        log.error(`No se pudo iniciar watcher '${wConfig.id}': ${e.message}`);
    }
}

function _debounce(
    wConfig: WatcherConfig,
    handle: WatcherHandle,
    event: FsEvent,
    filePath: string,
): void {
    const key = `${wConfig.id}:${filePath}`;
    const existing = debounceTimers.get(key);
    if (existing) clearTimeout(existing);

    const timer = setTimeout(() => {
        debounceTimers.delete(key);
        _fireGoal(wConfig, handle, event, filePath);
    }, wConfig.debounce);

    debounceTimers.set(key, timer);
}

function _fireGoal(
    wConfig: WatcherConfig,
    handle: WatcherHandle,
    event: FsEvent,
    filePath: string,
): void {
    // Substitute {{file}} and {{event}} in goal template
    const goal = wConfig.goal
        .replace(/\{\{file\}\}/g, filePath)
        .replace(/\{\{event\}\}/g, event);

    log.info(`Trigger '${wConfig.id}': [${event}] ${filePath}`);
    handle.fired++;
    handle.lastFire = new Date();

    // Submit to task queue (non-blocking)
    getQueue().submit(`[Watcher:${wConfig.id}] ${goal}`);
}

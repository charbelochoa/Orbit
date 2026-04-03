/**
 * Orbit Proactive Service — Sprint 5
 * Top-level orchestrator for all proactive triggers.
 * Starts/stops watchers and schedules, reacts to config changes.
 *
 * Usage:
 *   import { proactiveService } from "./proactive/service.js";
 *   await proactiveService.start();
 *   // ... on shutdown:
 *   await proactiveService.stop();
 */

import { createLogger } from "../infra/logger.js";
import { getConfig, onConfigRefresh } from "../config/config.js";
import { startWatchers, stopWatchers, getWatcherStats } from "./watcher.js";
import { startSchedules, stopSchedules, getScheduleStats, triggerNow } from "./scheduler.js";
import { broadcast } from "../gateway/server.js";

const log = createLogger("proactive");

class ProactiveService {
    private running = false;

    /**
     * Start the proactive service using current config.
     * Registers a config-refresh handler for hot-reload.
     */
    async start(): Promise<void> {
        if (this.running) return;

        const cfg = await getConfig();
        if (!cfg.proactive?.enabled) {
            log.debug("Proactive service deshabilitado en config (proactive.enabled: false)");
            return;
        }

        this.running = true;
        startWatchers(cfg.proactive);
        startSchedules(cfg.proactive);

        const watcherCount  = getWatcherStats().length;
        const scheduleCount = getScheduleStats().length;
        log.info(`Proactive service iniciado — ${watcherCount} watchers, ${scheduleCount} schedules`);

        broadcast({ type: "proactive_started", watchers: watcherCount, schedules: scheduleCount });

        // Hot reload: restart when config changes
        onConfigRefresh(async newCfg => {
            log.info("Config recargado — reiniciando proactive service");
            await this._restart(newCfg.proactive);
        });
    }

    /**
     * Stop all watchers and schedules.
     */
    async stop(): Promise<void> {
        if (!this.running) return;
        this.running = false;

        await stopWatchers();
        stopSchedules();

        log.info("Proactive service detenido");
        broadcast({ type: "proactive_stopped" });
    }

    /**
     * Get a combined snapshot of all trigger statuses.
     */
    status(): {
        enabled: boolean;
        watchers: ReturnType<typeof getWatcherStats>;
        schedules: ReturnType<typeof getScheduleStats>;
    } {
        return {
            enabled:   this.running,
            watchers:  getWatcherStats(),
            schedules: getScheduleStats(),
        };
    }

    /**
     * Manually fire a schedule by ID (e.g. from /trigger command).
     */
    triggerSchedule(id: string): boolean {
        return triggerNow(id);
    }

    get isRunning(): boolean { return this.running; }

    // ── Internal ─────────────────────────────────────────────────────────────

    private async _restart(proactiveCfg: Awaited<ReturnType<typeof getConfig>>["proactive"]): Promise<void> {
        await stopWatchers();
        stopSchedules();

        if (!proactiveCfg?.enabled) {
            this.running = false;
            return;
        }

        startWatchers(proactiveCfg);
        startSchedules(proactiveCfg);

        log.info(`Proactive service recargado — ${getWatcherStats().length} watchers, ${getScheduleStats().length} schedules`);
    }
}

export const proactiveService = new ProactiveService();

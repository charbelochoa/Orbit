/**
 * Orbit Proactive Scheduler — Sprint 5
 * Cron-based trigger engine using node-cron.
 * Fires AgentExecutor goals on a schedule defined in orbit.yaml.
 *
 * Supports full cron expressions (5-field) and shorthands:
 *   @hourly  @daily  @weekly  @monthly  @yearly
 */

import cron, { type ScheduledTask } from "node-cron";
import { createLogger } from "../infra/logger.js";
import { getQueue } from "../agent/task-queue.js";
import type { OrbitConfig } from "../config/schema.js";

const log = createLogger("proactive");

type ScheduleConfig = NonNullable<OrbitConfig["proactive"]>["schedules"][number];

interface ScheduleHandle {
    config:    ScheduleConfig;
    task:      ScheduledTask;
    fired:     number;
    lastFire:  Date | null;
    nextFire?: Date | null;
    status:    "active" | "stopped";
}

// Expand common shorthands to real cron expressions
const SHORTHANDS: Record<string, string> = {
    "@hourly":  "0 * * * *",
    "@daily":   "0 0 * * *",
    "@weekly":  "0 0 * * 0",
    "@monthly": "0 0 1 * *",
    "@yearly":  "0 0 1 1 *",
    "@midnight":"0 0 * * *",
};

const handles = new Map<string, ScheduleHandle>();

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Start all enabled cron schedules from config.
 */
export function startSchedules(cfg: OrbitConfig["proactive"]): void {
    if (!cfg.enabled) return;

    for (const sConfig of cfg.schedules) {
        if (!sConfig.enabled) continue;
        if (handles.has(sConfig.id)) continue;
        _startSchedule(sConfig);
    }

    log.info(`Cron schedules activos: ${handles.size}`);
}

/**
 * Stop all schedules gracefully.
 */
export function stopSchedules(): void {
    for (const h of handles.values()) {
        h.task.stop();
        h.status = "stopped";
    }
    handles.clear();
    log.info("Cron schedules detenidos");
}

/**
 * Pause a specific schedule without removing it.
 */
export function pauseSchedule(id: string): void {
    handles.get(id)?.task.stop();
}

/**
 * Resume a paused schedule.
 */
export function resumeSchedule(id: string): void {
    handles.get(id)?.task.start();
}

/**
 * Get status of all schedules.
 */
export function getScheduleStats(): Array<{
    id: string;
    cron: string;
    status: "active" | "stopped";
    fired: number;
    lastFire: Date | null;
}> {
    return Array.from(handles.values()).map(h => ({
        id:       h.config.id,
        cron:     h.config.cron,
        status:   h.status,
        fired:    h.fired,
        lastFire: h.lastFire,
    }));
}

/**
 * Immediately fire a schedule by ID (for testing/debugging).
 */
export function triggerNow(id: string): boolean {
    const h = handles.get(id);
    if (!h) return false;
    _fireGoal(h);
    return true;
}

// ── Internal ──────────────────────────────────────────────────────────────────

function _startSchedule(sConfig: ScheduleConfig): void {
    const expression = SHORTHANDS[sConfig.cron] || sConfig.cron;

    if (!cron.validate(expression)) {
        log.warn(`Schedule '${sConfig.id}' tiene expresión cron inválida: '${sConfig.cron}' — ignorado`);
        return;
    }

    try {
        const task = cron.schedule(expression, () => {
            const h = handles.get(sConfig.id);
            if (h) _fireGoal(h);
        }, {
            timezone: sConfig.timezone,
        });

        const handle: ScheduleHandle = {
            config:   sConfig,
            task,
            fired:    0,
            lastFire: null,
            status:   "active",
        };
        handles.set(sConfig.id, handle);

        log.debug(`Schedule '${sConfig.id}' programado: ${sConfig.cron}`);
    } catch (e: any) {
        log.error(`No se pudo iniciar schedule '${sConfig.id}': ${e.message}`);
    }
}

function _fireGoal(h: ScheduleHandle): void {
    h.fired++;
    h.lastFire = new Date();

    log.info(`Schedule '${h.config.id}' disparado: ${h.config.goal.slice(0, 60)}`);

    getQueue().submit(`[Schedule:${h.config.id}] ${h.config.goal}`);
}

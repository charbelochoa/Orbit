/**
 * Orbit Execution Lanes
 * Phase 4.2 — Semaphore-based concurrency control.
 * Prevents runaway parallel execution and callback storms.
 * Inspired by OpenClaw's lanes.ts.
 */

import { createLogger } from "../infra/logger.js";

const log = createLogger("Lanes");

// ── Semaphore ─────────────────────────────────────────────────────────────────

class Semaphore {
    private _count:   number;
    private _waiting: Array<() => void> = [];

    constructor(max: number) {
        this._count = max;
    }

    async acquire(): Promise<void> {
        if (this._count > 0) {
            this._count--;
            return;
        }
        return new Promise(resolve => this._waiting.push(resolve));
    }

    release(): void {
        const next = this._waiting.shift();
        if (next) {
            next();
        } else {
            this._count++;
        }
    }

    get available(): number { return this._count; }
    get waiting():   number { return this._waiting.length; }
}

// ── Lane limits ───────────────────────────────────────────────────────────────

const GLOBAL_CONCURRENCY    = 6;   // max inflight tool calls globally
const PER_SESSION_CONCURRENCY = 3; // max per session/subagent

const globalLane = new Semaphore(GLOBAL_CONCURRENCY);
const sessionLanes = new Map<string, Semaphore>();

function getSessionLane(sessionId: string): Semaphore {
    if (!sessionLanes.has(sessionId)) {
        sessionLanes.set(sessionId, new Semaphore(PER_SESSION_CONCURRENCY));
    }
    return sessionLanes.get(sessionId)!;
}

function removeSessionLane(sessionId: string): void {
    sessionLanes.delete(sessionId);
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Execute fn inside the global + per-session lanes.
 * Blocks until a slot is available in both.
 */
export async function runInLane<T>(
    sessionId: string,
    fn: () => Promise<T>
): Promise<T> {
    const sessionLane = getSessionLane(sessionId);

    await globalLane.acquire();
    await sessionLane.acquire();

    log.debug(`[${sessionId}] Lane acquired. Global slots: ${globalLane.available}, Session slots: ${sessionLane.available}`);

    try {
        return await fn();
    } finally {
        sessionLane.release();
        globalLane.release();
        log.debug(`[${sessionId}] Lane released.`);
    }
}

/**
 * Clean up lane resources for a session when it ends.
 */
export function destroySessionLane(sessionId: string): void {
    removeSessionLane(sessionId);
}

/**
 * Get current lane stats (for debugging/UI).
 */
export function getLaneStats(): {
    globalAvailable: number;
    globalWaiting: number;
    sessions: number;
} {
    return {
        globalAvailable: globalLane.available,
        globalWaiting:   globalLane.waiting,
        sessions:        sessionLanes.size,
    };
}

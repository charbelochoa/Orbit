/**
 * Orbit Context Registry — Sprint 2
 * Singleton registry for context engine instances.
 * One engine per session, with a default engine for the main session.
 */

import type { ContextEngine } from "./context-engine.js";
import { DefaultContextEngine } from "./default-engine.js";
import { createLogger } from "../infra/logger.js";

const log = createLogger("context");

const engines = new Map<string, ContextEngine>();

/**
 * Get or create a context engine for a session.
 * Bootstraps a new DefaultContextEngine on first access.
 */
export async function getContextEngine(sessionId: string): Promise<ContextEngine> {
    let engine = engines.get(sessionId);
    if (!engine) {
        engine = new DefaultContextEngine();
        await engine.bootstrap(sessionId);
        engines.set(sessionId, engine);
        log.debug(`New context engine for session: ${sessionId}`);
    }
    return engine;
}

/**
 * Register a custom context engine for a session (e.g. a plugin-provided engine).
 */
export function setContextEngine(sessionId: string, engine: ContextEngine): void {
    engines.set(sessionId, engine);
    log.info(`Custom context engine registered for session: ${sessionId}`);
}

/**
 * Remove a context engine (e.g. on session end).
 */
export function removeContextEngine(sessionId: string): void {
    engines.delete(sessionId);
}

/**
 * List all active session IDs with context engines.
 */
export function listContextSessions(): string[] {
    return Array.from(engines.keys());
}

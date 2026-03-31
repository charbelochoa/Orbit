/**
 * Orbit Hooks — Configuration loader
 * Loads hook rules from .orbit/settings.json and ~/.orbit/settings.json
 */
import fs from "fs";
import path from "path";
import os from "os";
import type { HookEvent, HookRule } from "./types.js";
import { createLogger } from "../infra/logger.js";

const log = createLogger("HooksConfig");

type HooksConfig = Partial<Record<HookEvent, HookRule[]>>;

let _hooks: HooksConfig = {};

/**
 * Load hook configuration from settings files.
 * Project settings override user settings for the same event.
 */
export function loadHooksConfig(): void {
    _hooks = {};

    // User-level hooks: ~/.orbit/settings.json
    const userPath = path.join(os.homedir(), ".orbit", "settings.json");
    mergeHooks(loadFromFile(userPath));

    // Project-level hooks: .orbit/settings.json
    const projectPath = path.join(process.cwd(), ".orbit", "settings.json");
    mergeHooks(loadFromFile(projectPath));

    // Local overrides: .orbit/settings.local.json
    const localPath = path.join(process.cwd(), ".orbit", "settings.local.json");
    mergeHooks(loadFromFile(localPath));

    const total = Object.values(_hooks).reduce((n, arr) => n + arr.length, 0);
    if (total > 0) {
        log.info(`Hooks cargados: ${total} regla(s) en ${Object.keys(_hooks).length} evento(s)`);
    }
}

function loadFromFile(filePath: string): HooksConfig {
    if (!fs.existsSync(filePath)) return {};
    try {
        const raw = JSON.parse(fs.readFileSync(filePath, "utf-8"));
        if (!raw.hooks || typeof raw.hooks !== "object") return {};

        const result: HooksConfig = {};
        for (const [event, rules] of Object.entries(raw.hooks)) {
            if (!isValidEvent(event)) {
                log.warn(`Hook event desconocido: '${event}' en ${filePath}`);
                continue;
            }
            if (!Array.isArray(rules)) continue;

            result[event as HookEvent] = (rules as any[])
                .filter(r => r && typeof r.command === "string")
                .map(r => ({
                    match:      r.match || undefined,
                    command:    r.command,
                    timeout_ms: r.timeout_ms || undefined,
                }));
        }
        return result;
    } catch (e: any) {
        log.warn(`Error leyendo hooks de ${filePath}: ${e.message}`);
        return {};
    }
}

function mergeHooks(incoming: HooksConfig): void {
    for (const [event, rules] of Object.entries(incoming)) {
        const key = event as HookEvent;
        if (!_hooks[key]) _hooks[key] = [];
        _hooks[key]!.push(...rules);
    }
}

const VALID_EVENTS: Set<string> = new Set([
    "PreToolUse", "PostToolUse",
    "SessionStart", "SessionEnd",
    "UserMessage", "AssistantMessage",
    "OrbitStop", "Notification",
]);

function isValidEvent(s: string): boolean {
    return VALID_EVENTS.has(s);
}

/**
 * Get all hook rules for a specific event.
 */
export function getHooksForEvent(event: HookEvent): HookRule[] {
    return _hooks[event] || [];
}

/**
 * Get the full hooks config (for debugging / /doctor).
 */
export function getAllHooks(): HooksConfig {
    return { ..._hooks };
}

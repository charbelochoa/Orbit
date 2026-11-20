/**
 * Orbit Config Loader
 * Phase 0.2 — Loads config from orbit.yaml, validates with Zod, merges .env vars.
 */

import fs from "fs";
import path from "path";
import { Console } from "node:console";
import { AsyncLocalStorage } from "node:async_hooks";
import dotenv from "dotenv";
import { parse as parseYaml } from "yaml";
import { orbitConfigSchema, type OrbitConfig } from "./schema.js";
import { createLogger, setSubsystemLevels } from "../infra/logger.js";
import { ORBIT_HOME, PROJECT_ROOT } from "./paths.js";

dotenv.config({ path: path.join(ORBIT_HOME, ".env") });

const log = createLogger("config", new Console({ stdout: process.stderr, stderr: process.stderr }));
let _config: OrbitConfig | null = null;
let configSource: unknown;
const configSnapshots = new AsyncLocalStorage<OrbitConfig>();

const providerEnvPaths = {
    GEMINI_API_KEY:    ["providers", "gemini", "apiKey"],
    OPENAI_API_KEY:    ["providers", "openai", "apiKey"],
    ANTHROPIC_API_KEY: ["providers", "anthropic", "apiKey"],
    ORBIT_PROVIDER:    ["defaultProvider"],
    GEMINI_MODEL:      ["providers", "gemini", "models", "fast"],
    GEMINI_LIVE_MODEL: ["providers", "gemini", "models", "live"],
    OPENAI_MODEL:      ["providers", "openai", "models", "default"],
    ANTHROPIC_MODEL:   ["providers", "anthropic", "models", "default"],
    OLLAMA_MODEL:      ["providers", "ollama", "models", "default"],
    GEMINI_BASE_URL:   ["providers", "gemini", "baseUrl"],
    OPENAI_BASE_URL:   ["providers", "openai", "baseUrl"],
    ANTHROPIC_BASE_URL: ["providers", "anthropic", "baseUrl"],
    OLLAMA_BASE_URL:   ["providers", "ollama", "baseUrl"],
} as const;

function readProviderSettings(value: unknown): Record<string, string> {
    if (typeof value !== "object" || !value || Array.isArray(value)) throw new Error("Ajustes de proveedores inválidos.");
    const settings: Record<string, string> = {};
    for (const [key, entry] of Object.entries(value)) {
        if (!Object.hasOwn(providerEnvPaths, key) || typeof entry !== "string" || entry.length > 2048) {
            throw new Error("Ajustes de proveedores inválidos.");
        }
        settings[key] = entry;
    }
    return settings;
}

const initialProviderSettings = process.env.ORBIT_DESKTOP_PROVIDER_OVERRIDES;
delete process.env.ORBIT_DESKTOP_PROVIDER_OVERRIDES;
let desktopProviderSettings = initialProviderSettings ? readProviderSettings(JSON.parse(initialProviderSettings)) : {};

// ── Config refresh handlers ──────────────────────────────────────────────────

type ConfigRefreshHandler = (config: OrbitConfig) => void;
const _refreshHandlers: ConfigRefreshHandler[] = [];

/** Register a callback that fires whenever config is reloaded */
export function onConfigRefresh(handler: ConfigRefreshHandler): void {
    _refreshHandlers.push(handler);
}

function _notifyRefresh(config: OrbitConfig): void {
    for (const h of _refreshHandlers) {
        try { h(config); } catch { /* handler errors don't break config load */ }
    }
}

/** Recursively replace ${VAR} placeholders with process.env values */
function resolveEnvVars(obj: any, env: Record<string, string | undefined>): any {
    if (typeof obj === "string") {
        return obj.replace(/\$\{(\w+)\}/g, (_, key) => env[key] || "");
    }
    if (Array.isArray(obj)) return obj.map(value => resolveEnvVars(value, env));
    if (obj && typeof obj === "object") {
        return Object.fromEntries(
            Object.entries(obj).map(([k, v]) => [k, resolveEnvVars(v, env)])
        );
    }
    return obj;
}

/** Merge well-known env vars into raw config for backward compat with .env */
function mergeEnvVars(raw: any, env: Record<string, string | undefined>): void {
    for (const [envKey, path] of Object.entries(providerEnvPaths)) {
        const val = env[envKey];
        if (!val) continue;
        let obj = raw;
        for (let i = 0; i < path.length - 1; i++) {
            if (!obj[path[i]]) obj[path[i]] = {};
            obj = obj[path[i]];
        }
        obj[path[path.length - 1]] = val;
    }
}

/**
 * Load and validate Orbit config (cached singleton).
 * Priority: orbit.yaml > .env > defaults
 */
function readConfigSource(configPath?: string): unknown {
    const userConfig = path.join(ORBIT_HOME, "orbit.yaml");
    const bundledConfig = path.join(PROJECT_ROOT, "config", "orbit.yaml");
    const filePath = configPath || process.env.ORBIT_CONFIG || (fs.existsSync(userConfig) ? userConfig : bundledConfig);
    if (fs.existsSync(filePath)) {
        log.info(`Config cargada desde ${filePath}`);
        return parseYaml(fs.readFileSync(filePath, "utf-8")) || {};
    }
    log.info("orbit.yaml no encontrado, usando .env + defaults");
    return {};
}

function resolveConfig(source: unknown, settings: Record<string, string>): OrbitConfig {
    const env = { ...process.env, ...settings };
    const raw = resolveEnvVars(source, env);
    mergeEnvVars(raw, env);
    return orbitConfigSchema.parse(raw);
}

function installConfig(source: unknown): OrbitConfig {
    const config = resolveConfig(source, desktopProviderSettings);
    configSource = source;
    _config = config;
    setSubsystemLevels(config.logging.subsystems);
    return config;
}

export function loadConfig(configPath?: string): OrbitConfig {
    return _config ?? installConfig(readConfigSource(configPath));
}

/** Get current config (lazy-loads on first call) */
export function getConfig(): OrbitConfig {
    return configSnapshots.getStore() ?? loadConfig();
}

export function withConfigSnapshot<T>(operation: () => T): T {
    return configSnapshots.run(loadConfig(), operation);
}

export function replaceDesktopProviderSettings(value: unknown): OrbitConfig {
    const settings = readProviderSettings(value);
    const current = loadConfig();
    const { providers, defaultProvider } = resolveConfig(configSource, settings);
    const config = { ...current, providers, defaultProvider };
    desktopProviderSettings = settings;
    _config = config;
    return config;
}

/** Force reload config from disk and notify all refresh handlers */
export function reloadConfig(configPath?: string): OrbitConfig {
    const cfg = installConfig(readConfigSource(configPath));
    _notifyRefresh(cfg);
    return cfg;
}

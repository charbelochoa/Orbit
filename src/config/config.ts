/**
 * Orbit Config Loader
 * Phase 0.2 — Loads config from orbit.yaml, validates with Zod, merges .env vars.
 */

import fs from "fs";
import path from "path";
import dotenv from "dotenv";
import { parse as parseYaml } from "yaml";
import { orbitConfigSchema, type OrbitConfig } from "./schema.js";
import { createLogger } from "../infra/logger.js";

dotenv.config();

const log = createLogger("Config");
let _config: OrbitConfig | null = null;

/** Recursively replace ${VAR} placeholders with process.env values */
function resolveEnvVars(obj: any): any {
    if (typeof obj === "string") {
        return obj.replace(/\$\{(\w+)\}/g, (_, key) => process.env[key] || "");
    }
    if (Array.isArray(obj)) return obj.map(resolveEnvVars);
    if (obj && typeof obj === "object") {
        return Object.fromEntries(
            Object.entries(obj).map(([k, v]) => [k, resolveEnvVars(v)])
        );
    }
    return obj;
}

/** Merge well-known env vars into raw config for backward compat with .env */
function mergeEnvVars(raw: any): void {
    const envMap: Record<string, string[]> = {
        GEMINI_API_KEY:    ["providers", "gemini", "apiKey"],
        OPENAI_API_KEY:    ["providers", "openai", "apiKey"],
        ANTHROPIC_API_KEY: ["providers", "anthropic", "apiKey"],
    };
    for (const [envKey, path] of Object.entries(envMap)) {
        const val = process.env[envKey];
        if (!val) continue;
        let obj = raw;
        for (let i = 0; i < path.length - 1; i++) {
            if (!obj[path[i]]) obj[path[i]] = {};
            obj = obj[path[i]];
        }
        if (!obj[path[path.length - 1]]) {
            obj[path[path.length - 1]] = val;
        }
    }
}

/**
 * Load and validate Orbit config (cached singleton).
 * Priority: orbit.yaml > .env > defaults
 */
export function loadConfig(configPath?: string): OrbitConfig {
    if (_config) return _config;

    const filePath = configPath || path.join(process.cwd(), "config", "orbit.yaml");
    let raw: any = {};

    if (fs.existsSync(filePath)) {
        const content = fs.readFileSync(filePath, "utf-8");
        raw = parseYaml(content) || {};
        log.info(`Config cargada desde ${filePath}`);
    } else {
        log.info("orbit.yaml no encontrado, usando .env + defaults");
    }

    raw = resolveEnvVars(raw);
    mergeEnvVars(raw);

    _config = orbitConfigSchema.parse(raw);
    return _config;
}

/** Get current config (lazy-loads on first call) */
export function getConfig(): OrbitConfig {
    if (!_config) return loadConfig();
    return _config;
}

/** Force reload config from disk (useful for hot-reload) */
export function reloadConfig(configPath?: string): OrbitConfig {
    _config = null;
    return loadConfig(configPath);
}

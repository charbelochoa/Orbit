/**
 * Orbit Plugin Loader — Sprint 4
 * Auto-discovers and loads plugins from ./plugins/ directory.
 * Also registers all built-in internal plugins (actions as plugins).
 * External plugins receive a PluginApi for slot registration.
 */

import fs from "fs";
import path from "path";
import { createLogger } from "../infra/logger.js";
import { pluginRegistry } from "./registry.js";
import { registerBuiltinPlugins } from "./builtins.js";
import type { OrbitPlugin } from "./types.js";
import type { HookEvent, HookRule } from "../hooks/types.js";
import type { CommandDef } from "../auto-reply/types.js";

const log = createLogger("plugins");

// ── Plugin API (passed to external plugin factories) ─────────────────────────

export interface OrbitPluginApi {
    /** The plugin ID this API belongs to. */
    pluginId: string;

    /** Register an additional tool. */
    registerTool(tool: import("../core/registry.js").OrbitTool): void;

    /** Register a hook. */
    registerHook(event: HookEvent, rule: HookRule): void;

    /** Register a slash command. */
    registerCommand(command: CommandDef): void;

    /** Register a provider (LLM, embedding, TTS, STT). */
    registerProvider(kind: "llm" | "embedding" | "tts" | "stt", name: string, factory: () => unknown): void;

    /** Register a background service. */
    registerService(name: string, start: () => Promise<void>, stop: () => Promise<void>): void;
}

function buildPluginApi(pluginId: string): OrbitPluginApi {
    return {
        pluginId,
        registerTool(tool)                  { pluginRegistry.registerTool(pluginId, tool); },
        registerHook(event, rule)           { pluginRegistry.registerHook(pluginId, event, rule); },
        registerCommand(command)            { pluginRegistry.registerCommand(pluginId, command); },
        registerProvider(kind, name, factory) { pluginRegistry.registerProvider(pluginId, kind, name, factory); },
        registerService(name, start, stop)  { pluginRegistry.registerService(pluginId, name, start, stop); },
    };
}

// ── Loader ───────────────────────────────────────────────────────────────────

/**
 * Bootstrap all plugins:
 * 1. Register built-in action plugins
 * 2. Scan ./plugins/ directory for external plugins
 */
export async function loadAllPlugins(pluginsDir?: string): Promise<void> {
    // 1. Built-ins first
    await registerBuiltinPlugins();
    log.info(`Built-in plugins registrados: ${pluginRegistry.count}`);

    // 2. External plugins directory
    const externalDir = pluginsDir || path.join(process.cwd(), "plugins");
    if (!fs.existsSync(externalDir)) {
        log.debug(`No existe directorio de plugins externos: ${externalDir}`);
        return;
    }

    const entries = fs.readdirSync(externalDir, { withFileTypes: true });
    for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const manifestPath = path.join(externalDir, entry.name, "manifest.json");
        const indexPath    = path.join(externalDir, entry.name, "index.js");

        if (!fs.existsSync(manifestPath) || !fs.existsSync(indexPath)) {
            log.warn(`Plugin '${entry.name}' ignorado: falta manifest.json o index.js`);
            continue;
        }

        try {
            const { default: pluginFactory } = await import(indexPath);

            // Support two patterns:
            // 1. Factory receives PluginApi: (api) => plugin
            // 2. Factory returns plugin directly: () => plugin | plugin
            let plugin: OrbitPlugin;
            if (typeof pluginFactory === "function") {
                const api = buildPluginApi(entry.name);
                const result = await pluginFactory(api);
                plugin = result as OrbitPlugin;
            } else {
                plugin = pluginFactory as OrbitPlugin;
            }

            await pluginRegistry.register(plugin);
        } catch (e: any) {
            log.error(`Error al importar plugin externo '${entry.name}': ${e.message}`);
        }
    }

    const stats = pluginRegistry.slotStats();
    log.info(`Plugins cargados: ${stats.plugins} plugins, ${stats.tools} tools, ${stats.commands} commands, ${stats.hooks} hooks`);
}

/**
 * Orbit Plugin Loader
 * Phase 3.3 — Auto-discovers and loads plugins from ./plugins/ directory.
 * Also registers all built-in internal plugins (actions as plugins).
 */

import fs from "fs";
import path from "path";
import { createLogger } from "../infra/logger.js";
import { pluginRegistry } from "./registry.js";
import { registerBuiltinPlugins } from "./builtins.js";

const log = createLogger("PluginLoader");

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
            const plugin = typeof pluginFactory === "function"
                ? await pluginFactory()
                : pluginFactory;
            await pluginRegistry.register(plugin);
        } catch (e: any) {
            log.error(`Error al importar plugin externo '${entry.name}':`, e.message);
        }
    }

    log.info(`Total plugins cargados: ${pluginRegistry.count}`);
}

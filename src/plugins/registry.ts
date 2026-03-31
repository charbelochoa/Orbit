/**
 * Orbit Plugin Registry
 * Phase 3.2 — Central registry and lifecycle manager for all plugins.
 */

import { createLogger } from "../infra/logger.js";
import { toolRegistry } from "../core/registry.js";
import type { OrbitPlugin, OrbitToolPlugin } from "./types.js";
import { isToolPlugin } from "./types.js";

const log = createLogger("PluginRegistry");

class PluginRegistryClass {
    private plugins = new Map<string, OrbitPlugin>();

    /**
     * Register and immediately set up a plugin.
     * Tool plugins auto-register their tools into the global toolRegistry.
     */
    async register(plugin: OrbitPlugin): Promise<void> {
        if (this.plugins.has(plugin.id)) {
            log.warn(`Plugin '${plugin.id}' ya registrado. Skipping.`);
            return;
        }

        try {
            await plugin.setup();
            this.plugins.set(plugin.id, plugin);
            log.info(`Plugin '${plugin.id}' v${plugin.version} cargado.`);

            // Auto-register tools into global toolRegistry
            if (isToolPlugin(plugin)) {
                const tools = plugin.getTools();
                for (const tool of tools) {
                    toolRegistry.register(tool);
                }
                log.info(`Plugin '${plugin.id}' registro ${tools.length} tools.`);
            }
        } catch (e: any) {
            log.error(`Error al cargar plugin '${plugin.id}':`, e.message);
        }
    }

    /**
     * Tear down and remove a plugin.
     */
    async unregister(pluginId: string): Promise<void> {
        const plugin = this.plugins.get(pluginId);
        if (!plugin) return;

        try {
            await plugin.teardown?.();
            this.plugins.delete(pluginId);
            log.info(`Plugin '${pluginId}' descargado.`);
        } catch (e: any) {
            log.error(`Error al descargar plugin '${pluginId}':`, e.message);
        }
    }

    get(id: string): OrbitPlugin | undefined {
        return this.plugins.get(id);
    }

    getAll(): OrbitPlugin[] {
        return Array.from(this.plugins.values());
    }

    getToolPlugins(): OrbitToolPlugin[] {
        return this.getAll().filter(isToolPlugin);
    }

    /**
     * Find the plugin that owns a specific tool ID.
     */
    findPluginForTool(toolId: string): OrbitToolPlugin | undefined {
        return this.getToolPlugins().find(p =>
            p.getTools().some(t => t.id === toolId)
        );
    }

    get count(): number {
        return this.plugins.size;
    }
}

export const pluginRegistry = new PluginRegistryClass();

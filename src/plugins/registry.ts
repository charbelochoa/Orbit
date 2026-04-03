/**
 * Orbit Plugin Registry — Sprint 4
 * Central registry with typed slots for tools, hooks, commands, providers,
 * channels, and services. Each plugin registers into the slots it uses.
 * Unregistering a plugin cleans all its slot entries.
 */

import { createLogger } from "../infra/logger.js";
import { toolRegistry } from "../core/registry.js";
import type {
    OrbitPlugin,
    OrbitToolPlugin,
    OrbitChannelPlugin,
    PluginRecord,
    PluginToolRegistration,
    PluginHookRegistration,
    PluginCommandRegistration,
    PluginProviderRegistration,
    PluginChannelRegistration,
    PluginServiceRegistration,
} from "./types.js";
import { isToolPlugin, isChannelPlugin } from "./types.js";
import type { HookEvent, HookRule } from "../hooks/types.js";
import type { CommandDef } from "../auto-reply/types.js";

const log = createLogger("plugins");

// ── Typed Slot Registry ──────────────────────────────────────────────────────

class PluginRegistryClass {
    // Plugin records
    private _plugins = new Map<string, PluginRecord>();

    // Typed slots
    private _tools:     PluginToolRegistration[]     = [];
    private _hooks:     PluginHookRegistration[]      = [];
    private _commands:  PluginCommandRegistration[]   = [];
    private _providers: PluginProviderRegistration[]  = [];
    private _channels:  PluginChannelRegistration[]   = [];
    private _services:  PluginServiceRegistration[]   = [];

    // ── Plugin Lifecycle ─────────────────────────────────────────────────────

    /**
     * Register and set up a plugin. Auto-registers tool plugins into
     * the global tool registry and populates the tools slot.
     */
    async register(plugin: OrbitPlugin): Promise<void> {
        if (this._plugins.has(plugin.id)) {
            log.warn(`Plugin '${plugin.id}' ya registrado — skipping`);
            return;
        }

        const record: PluginRecord = {
            plugin,
            loadedAt:    new Date(),
            healthy:     false,
            diagnostics: [],
        };

        try {
            await plugin.setup();
            record.healthy = true;
            this._plugins.set(plugin.id, record);

            // Auto-populate tool slot for tool plugins
            if (isToolPlugin(plugin)) {
                const tools = plugin.getTools();
                for (const tool of tools) {
                    this.registerTool(plugin.id, tool);
                }
                if (tools.length) {
                    log.debug(`Plugin '${plugin.id}' registró ${tools.length} tools`);
                }
            }

            // Auto-populate channel slot for channel plugins
            if (isChannelPlugin(plugin)) {
                this.registerChannel(plugin.id, plugin);
            }

            log.info(`Plugin '${plugin.id}' v${plugin.version} cargado`);
        } catch (e: any) {
            record.diagnostics.push(`setup failed: ${e.message}`);
            this._plugins.set(plugin.id, record);
            log.error(`Error al cargar plugin '${plugin.id}': ${e.message}`);
        }
    }

    /**
     * Tear down and remove a plugin, cleaning all its slot entries.
     */
    async unregister(pluginId: string): Promise<void> {
        const record = this._plugins.get(pluginId);
        if (!record) return;

        try {
            await record.plugin.teardown?.();
        } catch (e: any) {
            log.warn(`teardown error for '${pluginId}': ${e.message}`);
        }

        // Stop any services owned by this plugin
        for (const svc of this._services.filter(s => s.pluginId === pluginId)) {
            try { await svc.stop(); } catch { /* swallow */ }
        }

        // Clean all slots
        this._tools     = this._tools.filter(t => t.pluginId !== pluginId);
        this._hooks     = this._hooks.filter(h => h.pluginId !== pluginId);
        this._commands  = this._commands.filter(c => c.pluginId !== pluginId);
        this._providers = this._providers.filter(p => p.pluginId !== pluginId);
        this._channels  = this._channels.filter(c => c.pluginId !== pluginId);
        this._services  = this._services.filter(s => s.pluginId !== pluginId);

        this._plugins.delete(pluginId);
        log.info(`Plugin '${pluginId}' descargado (slots limpiados)`);
    }

    // ── Slot Registration ────────────────────────────────────────────────────

    registerTool(pluginId: string, tool: import("../core/registry.js").OrbitTool): void {
        if (this._tools.some(t => t.tool.id === tool.id)) {
            log.warn(`Tool '${tool.id}' ya registrado — ignorando duplicado de '${pluginId}'`);
            return;
        }
        this._tools.push({ pluginId, tool });
        toolRegistry.register(tool);
    }

    registerHook(pluginId: string, event: HookEvent, rule: HookRule): void {
        this._hooks.push({ pluginId, event, rule });
    }

    registerCommand(pluginId: string, command: CommandDef): void {
        if (this._commands.some(c => c.command.name === command.name)) {
            log.warn(`Command '/${command.name}' ya registrado — ignorando duplicado de '${pluginId}'`);
            return;
        }
        this._commands.push({ pluginId, command });
    }

    registerProvider(pluginId: string, kind: PluginProviderRegistration["kind"], name: string, factory: () => unknown): void {
        this._providers.push({ pluginId, kind, name, factory });
    }

    registerChannel(pluginId: string, channel: OrbitChannelPlugin): void {
        this._channels.push({ pluginId, channel });
    }

    registerService(pluginId: string, name: string, start: () => Promise<void>, stop: () => Promise<void>): void {
        this._services.push({ pluginId, name, start, stop });
    }

    // ── Query methods ────────────────────────────────────────────────────────

    get(id: string): OrbitPlugin | undefined {
        return this._plugins.get(id)?.plugin;
    }

    getRecord(id: string): PluginRecord | undefined {
        return this._plugins.get(id);
    }

    getAll(): OrbitPlugin[] {
        return Array.from(this._plugins.values()).map(r => r.plugin);
    }

    getToolPlugins(): OrbitToolPlugin[] {
        return this.getAll().filter(isToolPlugin);
    }

    /** Get all slot entries (for introspection / status). */
    get tools():     readonly PluginToolRegistration[]     { return this._tools; }
    get hooks():     readonly PluginHookRegistration[]      { return this._hooks; }
    get commands():  readonly PluginCommandRegistration[]   { return this._commands; }
    get providers(): readonly PluginProviderRegistration[]  { return this._providers; }
    get channels():  readonly PluginChannelRegistration[]   { return this._channels; }
    get services():  readonly PluginServiceRegistration[]   { return this._services; }

    /** Get tools owned by a specific plugin. */
    getToolsForPlugin(pluginId: string): PluginToolRegistration[] {
        return this._tools.filter(t => t.pluginId === pluginId);
    }

    /** Get hooks owned by a specific plugin. */
    getHooksForPlugin(pluginId: string): PluginHookRegistration[] {
        return this._hooks.filter(h => h.pluginId === pluginId);
    }

    /** Get commands owned by a specific plugin. */
    getCommandsForPlugin(pluginId: string): PluginCommandRegistration[] {
        return this._commands.filter(c => c.pluginId === pluginId);
    }

    /**
     * Find the plugin that owns a specific tool ID.
     */
    findPluginForTool(toolId: string): OrbitToolPlugin | undefined {
        const reg = this._tools.find(t => t.tool.id === toolId);
        if (!reg) return undefined;
        const plugin = this._plugins.get(reg.pluginId)?.plugin;
        return plugin && isToolPlugin(plugin) ? plugin : undefined;
    }

    get count(): number {
        return this._plugins.size;
    }

    /** Full slot stats for `orbit status`. */
    slotStats(): Record<string, number> {
        return {
            plugins:   this._plugins.size,
            tools:     this._tools.length,
            hooks:     this._hooks.length,
            commands:  this._commands.length,
            providers: this._providers.length,
            channels:  this._channels.length,
            services:  this._services.length,
        };
    }

    /**
     * List all plugins with their slot occupancy — useful for /doctor or diagnostics.
     */
    listPlugins(): Array<{
        id: string;
        version: string;
        healthy: boolean;
        slots: { tools: number; hooks: number; commands: number; services: number };
    }> {
        return Array.from(this._plugins.values()).map(r => ({
            id:      r.plugin.id,
            version: r.plugin.version,
            healthy: r.healthy,
            slots: {
                tools:    this._tools.filter(t => t.pluginId === r.plugin.id).length,
                hooks:    this._hooks.filter(h => h.pluginId === r.plugin.id).length,
                commands: this._commands.filter(c => c.pluginId === r.plugin.id).length,
                services: this._services.filter(s => s.pluginId === r.plugin.id).length,
            },
        }));
    }
}

export const pluginRegistry = new PluginRegistryClass();

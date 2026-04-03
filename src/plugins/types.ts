/**
 * Orbit Plugin SDK Types
 * Phase 3.1 + Sprint 4 — Plugin interfaces with typed slot registrations.
 * Inspired by OpenClaw's plugin-sdk with Orbit-specific simplifications.
 */

import type { OrbitTool } from "../core/registry.js";
import type { HookEvent, HookRule } from "../hooks/types.js";
import type { CommandDef } from "../auto-reply/types.js";

// ── Base Plugin ──────────────────────────────────────────────────────────────

export type PluginType = "tool" | "channel" | "provider" | "skill";

export interface PluginManifest {
    id:          string;
    name:        string;
    version:     string;
    description: string;
    author?:     string;
}

export interface OrbitPlugin extends PluginManifest {
    type: PluginType;
    setup():      Promise<void>;
    teardown?():  Promise<void>;
    isReady():    boolean;
}

// ── Tool Plugin ───────────────────────────────────────────────────────────────

export interface OrbitToolPlugin extends OrbitPlugin {
    type: "tool";
    getTools(): OrbitTool[];
    execute(toolId: string, args: any): Promise<string>;
}

// ── Channel Plugin ────────────────────────────────────────────────────────────

export interface InboundMessage {
    id:          string;
    channelId:   string;
    from:        string;
    content:     string;
    timestamp:   Date;
    metadata?:   Record<string, any>;
}

export interface OutboundMessage {
    to:        string;
    content:   string;
    replyTo?:  string;
    metadata?: Record<string, any>;
}

export type MessageHandler = (msg: InboundMessage) => Promise<void>;

export interface OrbitChannelPlugin extends OrbitPlugin {
    type: "channel";
    onMessage(handler: MessageHandler): void;
    sendMessage(msg: OutboundMessage): Promise<void>;
    getStatus(): "connected" | "disconnected" | "error";
}

// ── Slot Registrations ───────────────────────────────────────────────────────

/** A tool registered by a plugin into the global registry. */
export interface PluginToolRegistration {
    pluginId: string;
    tool:     OrbitTool;
}

/** A hook registered by a plugin. */
export interface PluginHookRegistration {
    pluginId: string;
    event:    HookEvent;
    rule:     HookRule;
}

/** A slash command registered by a plugin. */
export interface PluginCommandRegistration {
    pluginId: string;
    command:  CommandDef;
}

/** A provider registered by a plugin (e.g., LLM, embedding, TTS). */
export interface PluginProviderRegistration {
    pluginId: string;
    kind:     "llm" | "embedding" | "tts" | "stt";
    name:     string;
    factory:  () => unknown;
}

/** A channel registered by a plugin. */
export interface PluginChannelRegistration {
    pluginId: string;
    channel:  OrbitChannelPlugin;
}

/** A background service registered by a plugin. */
export interface PluginServiceRegistration {
    pluginId: string;
    name:     string;
    start:    () => Promise<void>;
    stop:     () => Promise<void>;
}

// ── Plugin Record (stored in registry) ──────────────────────────────────────

export interface PluginRecord {
    plugin:      OrbitPlugin;
    loadedAt:    Date;
    healthy:     boolean;
    diagnostics: string[];
}

// ── Guard helpers ─────────────────────────────────────────────────────────────

export function isToolPlugin(p: OrbitPlugin): p is OrbitToolPlugin {
    return p.type === "tool";
}

export function isChannelPlugin(p: OrbitPlugin): p is OrbitChannelPlugin {
    return p.type === "channel";
}

/**
 * Orbit Plugin SDK Types
 * Phase 3.1 — Interfaces every plugin must implement.
 * Inspired by OpenClaw's plugin-sdk with Orbit-specific simplifications.
 */

import type { OrbitTool } from "../core/registry.js";

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

// ── Guard helpers ─────────────────────────────────────────────────────────────

export function isToolPlugin(p: OrbitPlugin): p is OrbitToolPlugin {
    return p.type === "tool";
}

export function isChannelPlugin(p: OrbitPlugin): p is OrbitChannelPlugin {
    return p.type === "channel";
}

/**
 * Orbit Session Key System — Sprint 2
 * Canonical session key format for multi-channel, multi-agent support.
 *
 * Format: orbit:<agentId>:<channel>:<identifier>
 * Examples:
 *   orbit:main:cli:abc123
 *   orbit:main:web:sess_1712000000
 *   orbit:main:electron:sess_1712000000
 *   orbit:main:mcp:client_xyz
 *   orbit:cron:subagent:task_42
 */

// ── Types ────────────────────────────────────────────────────────────────────

export type SessionChannel =
    | "cli"
    | "web"
    | "electron"
    | "mcp"
    | "discord"
    | "telegram"
    | "whatsapp"
    | "subagent"
    | string;    // allow future channels

export type SessionChatType = "direct" | "group" | "subagent" | "unknown";

export interface SessionKeyParts {
    agentId:    string;
    channel:    SessionChannel;
    identifier: string;
}

// ── Build / Parse ────────────────────────────────────────────────────────────

/**
 * Build a canonical session key.
 * @example buildSessionKey({ channel: "cli", identifier: "abc" }) → "orbit:main:cli:abc"
 */
export function buildSessionKey(parts: {
    agentId?:   string;
    channel:    SessionChannel;
    identifier: string;
}): string {
    const agent = parts.agentId || "main";
    return `orbit:${agent}:${parts.channel}:${parts.identifier}`;
}

/**
 * Parse a session key into its parts.
 * Supports both new format "orbit:main:cli:abc" and legacy plain strings "orbit_123456".
 */
export function parseSessionKey(key: string): SessionKeyParts {
    if (key.startsWith("orbit:")) {
        const parts = key.split(":");
        if (parts.length >= 4) {
            return {
                agentId:    parts[1],
                channel:    parts[2] as SessionChannel,
                identifier: parts.slice(3).join(":"),
            };
        }
    }
    // Legacy format — treat as main agent, unknown channel
    return {
        agentId:    "main",
        channel:    "unknown",
        identifier: key,
    };
}

// ── Utilities ────────────────────────────────────────────────────────────────

/** Derive the chat type from a session key */
export function deriveSessionType(key: string): SessionChatType {
    const { channel } = parseSessionKey(key);
    if (channel === "subagent") return "subagent";
    if (channel === "discord" || channel === "telegram") return "group";
    return "direct";
}

/** Check if this is a subagent session */
export function isSubagentSession(key: string): boolean {
    return parseSessionKey(key).channel === "subagent";
}

/** Extract the agent ID from a session key */
export function getAgentId(key: string): string {
    return parseSessionKey(key).agentId;
}

/** Extract the channel from a session key */
export function getChannel(key: string): SessionChannel {
    return parseSessionKey(key).channel;
}

/**
 * Build a legacy-compatible session ID (for backward compat with existing code).
 * Returns the identifier portion for use with chat-history.ts.
 */
export function toLegacySessionId(key: string): string {
    return parseSessionKey(key).identifier;
}

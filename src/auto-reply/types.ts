/**
 * Orbit Auto-Reply System — Phase 6
 * Shared types for command detection and the reply dispatcher.
 */

import type { WebSocket } from "ws";

// ── Command context passed to every handler ───────────────────────────────────

export interface CommandContext {
    /** WebSocket client ID */
    clientId:   string;
    /** Send a structured reply to this specific client */
    sendReply:  (msg: Record<string, unknown>) => void;
    /** Optional speak function that routes text to Gemini Live */
    speakFn?:   (text: string) => void;
    /** Original raw text received (including the leading /) */
    rawText:    string;
    /** Words after the command name, e.g. ["search", "query"] */
    args:       string[];
    /** First word after the command name (convenience) */
    subcommand: string;
    /** Everything after the subcommand as one string */
    argStr:     string;
}

export type CommandHandler = (ctx: CommandContext) => Promise<string | void>;

// ── Command definition ────────────────────────────────────────────────────────

export interface CommandDef {
    name:        string;
    aliases?:    string[];
    description: string;
    usage:       string;
    handler:     CommandHandler;
}

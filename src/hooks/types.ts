/**
 * Orbit Hooks — Type definitions
 * Phase 6: Lifecycle hooks for injecting custom behavior.
 */

// ── Hook Events ──────────────────────────────────────────────────────────────

export type HookEvent =
    | "PreToolUse"
    | "PostToolUse"
    | "SessionStart"
    | "SessionEnd"
    | "UserMessage"
    | "AssistantMessage"
    | "OrbitStop"
    | "Notification";

// ── Hook Context (data passed to hook commands) ──────────────────────────────

export interface HookContext {
    /** Which event triggered this hook */
    event: HookEvent;

    /** Tool name (for PreToolUse / PostToolUse) */
    tool_name?: string;

    /** Tool input parameters (for PreToolUse / PostToolUse) */
    tool_input?: Record<string, any>;

    /** Tool output (for PostToolUse) */
    tool_output?: string;

    /** Whether the tool succeeded (for PostToolUse) */
    tool_success?: boolean;

    /** User message text (for UserMessage) */
    user_message?: string;

    /** Assistant message text (for AssistantMessage) */
    assistant_message?: string;

    /** Session duration in seconds (for SessionEnd) */
    session_duration_s?: number;

    /** Notification text (for Notification) */
    notification?: string;

    /** Current working directory */
    cwd: string;
}

// ── Hook Rule (from settings) ────────────────────────────────────────────────

export interface HookRule {
    /** Optional: only run if tool name matches this glob (for Pre/PostToolUse) */
    match?: string;

    /** Shell command to execute. Supports ${variable} interpolation from context. */
    command: string;

    /** Timeout in ms (default: 10000) */
    timeout_ms?: number;
}

// ── Hook Result ──────────────────────────────────────────────────────────────

export interface HookResult {
    rule:    HookRule;
    event:   HookEvent;
    exitCode: number | null;
    stdout:  string;
    stderr:  string;
    /** If true, the tool execution should be blocked (PreToolUse returned non-zero) */
    blocked: boolean;
    durationMs: number;
}

/**
 * Orbit Hooks — Runner
 * Phase 6: Executes hook commands with interpolated context variables.
 *
 * Hook commands receive context via environment variables (ORBIT_*) and
 * ${variable} template interpolation in the command string.
 *
 * PreToolUse hooks can BLOCK the tool if they exit with non-zero code.
 */
import { exec } from "child_process";
import { getHooksForEvent, loadHooksConfig } from "./config.js";
import type { HookEvent, HookContext, HookRule, HookResult } from "./types.js";
import { createLogger } from "../infra/logger.js";

const log = createLogger("HooksRunner");

const DEFAULT_TIMEOUT = 10_000;
const MAX_OUTPUT = 2000;

// ── Initialization ───────────────────────────────────────────────────────────

let _initialized = false;

export function initHooks(): void {
    if (_initialized) return;
    loadHooksConfig();
    _initialized = true;
}

export function reloadHooks(): void {
    loadHooksConfig();
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Run all hooks for a given event. Returns results for each rule.
 * For PreToolUse: if any hook exits non-zero, returns blocked=true.
 */
export async function runHooks(event: HookEvent, context: Partial<HookContext> = {}): Promise<HookResult[]> {
    initHooks();

    const rules = getHooksForEvent(event);
    if (rules.length === 0) return [];

    const ctx: HookContext = {
        event,
        cwd: process.cwd(),
        ...context,
    };

    // Filter rules by match pattern (for Pre/PostToolUse)
    const applicable = rules.filter(rule => matchesRule(rule, ctx));
    if (applicable.length === 0) return [];

    log.debug(`Running ${applicable.length} hook(s) for ${event}`);

    const results: HookResult[] = [];
    for (const rule of applicable) {
        const result = await executeHookCommand(rule, ctx, event);
        results.push(result);

        // PreToolUse: if blocked, stop running more hooks
        if (event === "PreToolUse" && result.blocked) {
            log.info(`Hook blocked tool ${ctx.tool_name}: ${rule.command.slice(0, 60)}`);
            break;
        }
    }

    return results;
}

/**
 * Convenience: run PreToolUse hooks and return whether the tool should be blocked.
 */
export async function runPreToolHooks(toolName: string, args: Record<string, any>): Promise<{ blocked: boolean; reason?: string }> {
    const results = await runHooks("PreToolUse", {
        tool_name: toolName,
        tool_input: args,
    });

    const blocker = results.find(r => r.blocked);
    if (blocker) {
        return {
            blocked: true,
            reason: blocker.stderr.trim() || blocker.stdout.trim() || `Hook bloqueó ${toolName}`,
        };
    }
    return { blocked: false };
}

/**
 * Convenience: run PostToolUse hooks.
 */
export async function runPostToolHooks(
    toolName: string, args: Record<string, any>, output: string, success: boolean,
): Promise<void> {
    await runHooks("PostToolUse", {
        tool_name: toolName,
        tool_input: args,
        tool_output: output,
        tool_success: success,
    });
}

// ── Internal ─────────────────────────────────────────────────────────────────

function matchesRule(rule: HookRule, ctx: HookContext): boolean {
    if (!rule.match) return true;

    const target = ctx.tool_name || "";
    if (!target) return true;

    // Glob-like match: "Bash" matches "cmd_control", "file_*" matches "file_edit" etc.
    const pattern = rule.match
        .replace(/[.+^${}()|[\]\\]/g, "\\$&")
        .replace(/\*/g, ".*");
    return new RegExp(`^${pattern}$`, "i").test(target);
}

function interpolateCommand(command: string, ctx: HookContext): string {
    return command.replace(/\$\{([a-zA-Z_][a-zA-Z_0-9.]*)\}/g, (_, key: string) => {
        // Support nested keys: tool_input.file_path
        const parts = key.split(".");
        let value: any = ctx;
        for (const part of parts) {
            if (value == null || typeof value !== "object") return "";
            value = (value as Record<string, any>)[part];
        }
        if (value == null) return "";
        return typeof value === "string" ? value : JSON.stringify(value);
    });
}

function buildEnv(ctx: HookContext): Record<string, string> {
    const env: Record<string, string> = { ...process.env as Record<string, string> };

    env.ORBIT_EVENT = ctx.event;
    env.ORBIT_CWD = ctx.cwd;

    if (ctx.tool_name)    env.ORBIT_TOOL_NAME = ctx.tool_name;
    if (ctx.tool_output)  env.ORBIT_TOOL_OUTPUT = ctx.tool_output.slice(0, 5000);
    if (ctx.tool_success !== undefined) env.ORBIT_TOOL_SUCCESS = String(ctx.tool_success);
    if (ctx.user_message) env.ORBIT_USER_MESSAGE = ctx.user_message;
    if (ctx.assistant_message) env.ORBIT_ASSISTANT_MESSAGE = ctx.assistant_message.slice(0, 5000);
    if (ctx.notification) env.ORBIT_NOTIFICATION = ctx.notification;
    if (ctx.session_duration_s !== undefined) env.ORBIT_SESSION_DURATION = String(ctx.session_duration_s);

    // Flatten tool_input as ORBIT_INPUT_*
    if (ctx.tool_input) {
        for (const [k, v] of Object.entries(ctx.tool_input)) {
            const envKey = `ORBIT_INPUT_${k.toUpperCase()}`;
            env[envKey] = typeof v === "string" ? v : JSON.stringify(v);
        }
    }

    return env;
}

async function executeHookCommand(rule: HookRule, ctx: HookContext, event: HookEvent): Promise<HookResult> {
    const startTime = Date.now();
    const command = interpolateCommand(rule.command, ctx);
    const timeout = rule.timeout_ms || DEFAULT_TIMEOUT;
    const env = buildEnv(ctx);

    log.debug(`Hook [${event}]: ${command.slice(0, 80)}`);

    return new Promise<HookResult>((resolve) => {
        const child = exec(command, {
            cwd: ctx.cwd,
            timeout,
            env,
            shell: "powershell.exe",
            maxBuffer: 256 * 1024,
        }, (error, stdout, stderr) => {
            const durationMs = Date.now() - startTime;
            const exitCode = error ? (error as any).code ?? 1 : 0;
            const blocked = event === "PreToolUse" && exitCode !== 0;

            resolve({
                rule,
                event,
                exitCode,
                stdout: (stdout || "").slice(0, MAX_OUTPUT),
                stderr: (stderr || "").slice(0, MAX_OUTPUT),
                blocked,
                durationMs,
            });
        });

        // Safety: if child hangs past timeout, force kill is handled by exec timeout
        child.on("error", () => {
            resolve({
                rule,
                event,
                exitCode: 1,
                stdout: "",
                stderr: "Hook process error",
                blocked: event === "PreToolUse",
                durationMs: Date.now() - startTime,
            });
        });
    });
}

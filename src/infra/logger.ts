/**
 * Orbit Structured Logger
 * Phase 0.3 → Sprint 1 — Subsystem logger with colors, per-subsystem levels, and token redaction.
 */

export type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_PRIORITY: Record<LogLevel, number> = {
    debug: 0,
    info: 1,
    warn: 2,
    error: 3,
};

let _currentLevel: LogLevel = "info";
let _subsystemLevels: Record<string, LogLevel> = {};

export function setLogLevel(level: LogLevel) {
    _currentLevel = level;
}

export function getLogLevel(): LogLevel {
    return _currentLevel;
}

/**
 * Set per-subsystem log levels.
 * E.g. { skills: "debug", context: "warn" }
 */
export function setSubsystemLevels(levels: Record<string, LogLevel>) {
    _subsystemLevels = { ...levels };
}

export interface Logger {
    debug: (...args: any[]) => void;
    info:  (...args: any[]) => void;
    warn:  (...args: any[]) => void;
    error: (...args: any[]) => void;
}

// ── Subsystem colors (ANSI) ──────────────────────────────────────────────────

const SUBSYSTEM_COLORS: Record<string, string> = {
    skills:   "\x1b[32m",   // green
    context:  "\x1b[34m",   // blue
    plugins:  "\x1b[33m",   // yellow
    memory:   "\x1b[35m",   // magenta
    agent:    "\x1b[36m",   // cyan
    planner:  "\x1b[36m",   // cyan
    executor: "\x1b[36m",   // cyan
    mcp:      "\x1b[31m",   // red
    gateway:  "\x1b[37m",   // white
    config:   "\x1b[90m",   // gray
    hooks:    "\x1b[33m",   // yellow
};

const RESET = "\x1b[0m";
const isTTY = process.stdout.isTTY ?? false;

// ── Token redaction ──────────────────────────────────────────────────────────

const TOKEN_PATTERNS = [
    /sk-[a-zA-Z0-9]{20,}/g,            // OpenAI
    /AIza[a-zA-Z0-9_\-]{35}/g,         // Google API key
    /sk-ant-[a-zA-Z0-9_\-]{40,}/g,     // Anthropic
    /ghp_[a-zA-Z0-9]{36}/g,            // GitHub PAT
    /gho_[a-zA-Z0-9]{36}/g,            // GitHub OAuth
    /xoxb-[a-zA-Z0-9\-]+/g,            // Slack bot
    /xoxp-[a-zA-Z0-9\-]+/g,            // Slack user
    /secret_[a-zA-Z0-9]{30,}/g,        // Notion
    /ntn_[a-zA-Z0-9]{30,}/g,           // Notion v2
    /AKIA[0-9A-Z]{16}/g,               // AWS Access Key
];

function redact(value: string): string {
    let result = value;
    for (const pattern of TOKEN_PATTERNS) {
        result = result.replace(pattern, "[REDACTED]");
    }
    return result;
}

function redactArgs(args: any[]): any[] {
    return args.map(a => (typeof a === "string" ? redact(a) : a));
}

// ── Logger factory ───────────────────────────────────────────────────────────

/**
 * Create a logger for a subsystem.
 * Backward-compatible: `createLogger("ModuleName")` still works exactly as before.
 * Colors are applied automatically when stdout is a TTY.
 */
export function createLogger(subsystem: string): Logger {
    const key = subsystem.toLowerCase();
    const color = isTTY ? (SUBSYSTEM_COLORS[key] ?? "\x1b[0m") : "";
    const reset = isTTY ? RESET : "";
    const prefix = `${color}[${subsystem}]${reset}`;

    function shouldLog(level: LogLevel): boolean {
        const effectiveLevel = _subsystemLevels[key] ?? _currentLevel;
        return LEVEL_PRIORITY[level] >= LEVEL_PRIORITY[effectiveLevel];
    }

    return {
        debug: (...args: any[]) => { if (shouldLog("debug")) console.debug(prefix, ...redactArgs(args)); },
        info:  (...args: any[]) => { if (shouldLog("info"))  console.log(prefix, ...redactArgs(args)); },
        warn:  (...args: any[]) => { if (shouldLog("warn"))  console.warn(prefix, ...redactArgs(args)); },
        error: (...args: any[]) => { if (shouldLog("error")) console.error(prefix, ...redactArgs(args)); },
    };
}

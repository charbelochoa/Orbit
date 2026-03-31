/**
 * Orbit Structured Logger
 * Phase 0.3 — Drop-in replacement for console.log with levels and module context.
 */

export type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_PRIORITY: Record<LogLevel, number> = {
    debug: 0,
    info: 1,
    warn: 2,
    error: 3,
};

let _currentLevel: LogLevel = "info";

export function setLogLevel(level: LogLevel) {
    _currentLevel = level;
}

export function getLogLevel(): LogLevel {
    return _currentLevel;
}

export interface Logger {
    debug: (...args: any[]) => void;
    info:  (...args: any[]) => void;
    warn:  (...args: any[]) => void;
    error: (...args: any[]) => void;
}

export function createLogger(module: string): Logger {
    const prefix = `[${module}]`;

    function shouldLog(level: LogLevel): boolean {
        return LEVEL_PRIORITY[level] >= LEVEL_PRIORITY[_currentLevel];
    }

    return {
        debug: (...args: any[]) => { if (shouldLog("debug")) console.debug(prefix, ...args); },
        info:  (...args: any[]) => { if (shouldLog("info"))  console.log(prefix, ...args); },
        warn:  (...args: any[]) => { if (shouldLog("warn"))  console.warn(prefix, ...args); },
        error: (...args: any[]) => { if (shouldLog("error")) console.error(prefix, ...args); },
    };
}

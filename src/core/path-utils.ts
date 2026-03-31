/**
 * Orbit Path Utilities — Phase 8.3
 * Windows-first path handling: normalization, drive letters, UNC, UAC awareness.
 */

import os from "os";
import path from "path";
import { execSync } from "child_process";

// ── Path normalization ───────────────────────────────────────────────────────

/** Normalize any path to OS-native separators and resolve relative segments. */
export function normalizePath(p: string): string {
    if (!p) return p;
    // Expand ~ to home dir
    if (p.startsWith("~")) {
        p = path.join(os.homedir(), p.slice(1));
    }
    // Normalize separators and resolve ./ ../
    return path.resolve(p);
}

/** Check if a string looks like a Windows absolute path (C:\..., \\server\...). */
export function isWindowsAbsolute(p: string): boolean {
    return /^[A-Za-z]:[\\/]/.test(p) || p.startsWith("\\\\");
}

/** Check if it's a UNC path (\\server\share). */
export function isUNCPath(p: string): boolean {
    return p.startsWith("\\\\");
}

// ── UAC awareness ────────────────────────────────────────────────────────────

let _isElevated: boolean | null = null;

/** Check if the current process is running as Administrator. Cached after first call. */
export function isElevated(): boolean {
    if (_isElevated !== null) return _isElevated;

    if (os.platform() !== "win32") {
        _isElevated = process.getuid?.() === 0 || false;
        return _isElevated;
    }

    try {
        // net session requires admin; exits with error code if not admin
        execSync("net session", { stdio: "ignore", timeout: 3000 });
        _isElevated = true;
    } catch {
        _isElevated = false;
    }
    return _isElevated;
}

// ── Shell detection ──────────────────────────────────────────────────────────

export type ShellType = "powershell" | "pwsh" | "cmd" | "bash" | "unknown";

/** Detect the best available shell on this system. */
export function detectShell(): ShellType {
    if (os.platform() !== "win32") return "bash";

    // Prefer pwsh (PowerShell 7+) if available
    try {
        execSync("pwsh -NoProfile -Command $PSVersionTable.PSVersion", { stdio: "ignore", timeout: 3000 });
        return "pwsh";
    } catch { /* not installed */ }

    // Fall back to Windows PowerShell 5.1
    return "powershell";
}

/** Get the shell executable path for spawning. */
export function getShellCommand(shell?: ShellType): string {
    const s = shell || detectShell();
    switch (s) {
        case "pwsh":       return "pwsh";
        case "powershell": return "powershell";
        case "cmd":        return "cmd.exe";
        case "bash":       return "bash";
        default:           return "powershell";
    }
}

// ── Windows Terminal integration ─────────────────────────────────────────────

/** Check if Windows Terminal (wt.exe) is available. */
export function hasWindowsTerminal(): boolean {
    if (os.platform() !== "win32") return false;
    try {
        execSync("where wt.exe", { stdio: "ignore", timeout: 3000 });
        return true;
    } catch {
        return false;
    }
}

// ── Safe path for display ────────────────────────────────────────────────────

/** Shorten a path for display: replace home dir with ~, truncate if too long. */
export function displayPath(p: string, maxLen = 60): string {
    const home = os.homedir();
    let display = p;
    if (display.startsWith(home)) {
        display = "~" + display.slice(home.length);
    }
    // Normalize to forward-slash for display
    display = display.replace(/\\/g, "/");
    if (display.length > maxLen) {
        const parts = display.split("/");
        if (parts.length > 3) {
            display = parts[0] + "/.../" + parts.slice(-2).join("/");
        }
    }
    return display;
}

/** Ensure a directory path always ends with the OS separator. */
export function ensureTrailingSep(p: string): string {
    if (!p.endsWith(path.sep) && !p.endsWith("/")) {
        return p + path.sep;
    }
    return p;
}

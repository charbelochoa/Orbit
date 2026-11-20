import { spawn, type ChildProcess, type SpawnOptions } from "node:child_process";
import os from "os";
import { EventEmitter } from "events";
import { normalizePath, getShellCommand, isElevated } from "../core/path-utils.js";
import { workspaceRoot } from "../core/workspace.js";
import { boundToolResult } from "../context/text-budget.js";
import { OrbitToolError } from "../core/orbit-error.js";

// ── Background process tracker ───────────────────────────────
export const cmdEvents = new EventEmitter();
const backgroundProcesses = new Map<string, { pid: number; label: string; startedAt: number }>();

export function getBackgroundProcesses() {
    return Array.from(backgroundProcesses.entries()).map(([id, info]) => ({
        id, ...info, runningMs: Date.now() - info.startedAt,
    }));
}

// ── Safety hook: block dangerous commands ────────────────────────
const BLOCKED_PATTERNS: RegExp[] = [
    /rm\s+-rf\s*[\/\\]/i,
    /Remove-Item\s+.*-Recurse.*-Force/i,
    /format\s+[a-zA-Z]:/i,
    /del\s+\/[fF]\s+\/[sS]/i,
    /rd\s+\/[sS]\s+\/[qQ]\s+[a-zA-Z]:\\/i,
    /shutdown\s+\/[srsf]/i,
    /bcdedit/i,
    /diskpart/i,
    /netsh\s+(firewall|advfirewall)/i,
    /reg\s+(delete|add)\s+HKLM/i,
    /icacls.*\/grant.*Everyone/i,
    /cipher\s+\/w/i,
    /sfc\s+\/scannow/i,
];

// ── Read-only commands (auto-collapsible in UI) ──────────────
/** Redact likely credentials from a command string before logging */
function redactCmd(cmd: string): string {
    return cmd
        .replace(/password[=:]\s*\S+/gi, "password=***")
        .replace(/(-p|--password)\s+\S+/gi, "$1 ***")
        .replace(/:([^/@:]{2,})@/g, ":***@")
        .replace(/(token|secret|key|api_key)[=:]\s*\S+/gi, "$1=***");
}

const READ_ONLY_PATTERNS = [
    /^git\s+(status|log|diff|show|branch|remote)/i,
    /^(ls|dir|cat|type|Get-Content|Get-ChildItem)\b/i,
    /^(echo|Write-Output|Write-Host)\b/i,
    /^(node|python|pip|npm|npx)\s+(-v|--version)/i,
    /^(wc|head|tail|find|where|which|Get-Command)\b/i,
];

export function isReadOnlyCommand(cmd: string): boolean {
    return READ_ONLY_PATTERNS.some(p => p.test(cmd.trim()));
}

function isSafeCommand(cmd: string): boolean {
    const lower = cmd.toLowerCase();
    for (const pattern of BLOCKED_PATTERNS) {
        if (pattern.test(cmd) || pattern.test(lower)) return false;
    }
    return true;
}

export interface CmdControlParams {
    task?: string;
    command?: string;
    cwd?: string;
    timeout_ms?: number;
    run_in_background?: boolean;
}

export async function cmdControl(p: CmdControlParams, signal?: AbortSignal): Promise<string> {
    signal?.throwIfAborted();
    const command = typeof p?.command === "string" ? p.command : "";
    const task = typeof p?.task === "string" ? p.task : "";
    const text = command || task;
    if (!text.trim()) throw new OrbitToolError("cmd_control", "INVALID_PARAMS", "Indica un comando.");
    if (!isSafeCommand(text)) {
        throw new OrbitToolError("cmd_control", "PERMISSION_DENIED", "El comando contiene una operación bloqueada.");
    }

    const cwd = normalizePath(p.cwd || workspaceRoot());
    const timeout = typeof p.timeout_ms === "number" && Number.isFinite(p.timeout_ms)
        ? Math.min(Math.max(p.timeout_ms, 1000), 120_000)
        : 30_000;
    if (/schtasks|netsh|sc\s+(config|start|stop)|reg\s/i.test(text) && !isElevated()) {
        console.warn("[CMD Control] El comando puede requerir permisos de administrador.");
    }
    const options: SpawnOptions = { cwd, stdio: ["ignore", "pipe", "pipe"], windowsHide: true };
    const child = command
        ? spawn(command, { ...options, shell: true })
        : spawn(getShellCommand(), process.platform === "win32" ? ["-NoProfile", "-NonInteractive", "-Command", task] : ["-c", task], options);
    const handle = observeProcess(child, redactCmd(text).slice(0, 100), Boolean(p.run_in_background));
    if (p.run_in_background) return handle.started;

    let timeoutReached = false;
    const threshold = setTimeout(() => {
        timeoutReached = true;
        stopProcess(child);
    }, timeout);
    const abort = () => stopProcess(child);
    signal?.addEventListener("abort", abort, { once: true });
    try {
        const result = await handle.finished;
        signal?.throwIfAborted();
        if (timeoutReached) throw new OrbitToolError("cmd_control", "TIMEOUT", "Se agotó el tiempo del comando.");
        const output = [result.stdout.trim(), result.stderr.trim()].filter(Boolean).join("\n");
        if (result.code !== 0) {
            throw new OrbitToolError("cmd_control", "TOOL_FAILED", output || "El comando terminó con código " + result.code + ".");
        }
        return output || "Comando completado.";
    } finally {
        clearTimeout(threshold);
        signal?.removeEventListener("abort", abort);
    }
}

let bgCounter = 0;

function observeProcess(child: ChildProcess, label: string, background: boolean) {
    const id = background ? "bg-" + (++bgCounter) : "";
    const started = new Promise<string>((resolve, reject) => {
        child.once("spawn", () => {
            if (background) {
                const pid = child.pid ?? 0;
                backgroundProcesses.set(id, { pid, label, startedAt: Date.now() });
                resolve("Proceso en segundo plano " + id + " (PID " + pid + ").");
            } else resolve("");
        });
        child.once("error", reject);
    });
    void started.catch(() => {});
    const finished = new Promise<{code: number | null; stdout: string; stderr: string}>((resolve, reject) => {
        let stdout = "";
        let stderr = "";
        child.stdout?.setEncoding("utf-8").on("data", (text: string) => {
            stdout = boundToolResult(stdout + text, 8000);
            if (id) cmdEvents.emit("output", { id, type: "stdout", text });
        });
        child.stderr?.setEncoding("utf-8").on("data", (text: string) => {
            stderr = boundToolResult(stderr + text, 4000);
            if (id) cmdEvents.emit("output", { id, type: "stderr", text });
        });
        child.once("error", reject);
        child.once("close", code => {
            if (id) {
                backgroundProcesses.delete(id);
                cmdEvents.emit("done", { id, code, stdout, stderr });
            }
            resolve({ code, stdout, stderr });
        });
    });
    void finished.catch(() => {});
    return { started, finished };
}

function stopProcess(child: ChildProcess): void {
    if (!child.pid || child.exitCode !== null || child.signalCode !== null) return;
    if (process.platform !== "win32") {
        child.kill("SIGTERM");
        return;
    }
    const killer = spawn("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
    killer.once("error", () => child.kill());
    killer.once("close", code => {
        if (code !== 0 && child.exitCode === null && child.signalCode === null) child.kill();
    });
}

import { exec, spawn } from "child_process";
import { promisify } from "util";
import os from "os";
import { EventEmitter } from "events";
import { normalizePath, getShellCommand, isElevated } from "../core/path-utils.js";

const execAsync = promisify(exec);

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

export async function cmdControl(parameters: any): Promise<string> {
    const p = parameters as CmdControlParams;
    const task = p?.task || "";
    const command = p?.command || "";

    if (!task && !command) {
        return "Se necesita una 'task' o 'command' para ejecutar.";
    }

    const cmdToCheck = command || task;
    if (!isSafeCommand(cmdToCheck)) {
        console.warn(`[CMD Control] Comando bloqueado por seguridad: ${cmdToCheck.slice(0, 100)}`);
        return "Comando bloqueado: operación potencialmente peligrosa no permitida.";
    }

    const cwd = normalizePath(p?.cwd || process.cwd());
    const timeoutMs = Math.min(Math.max(p?.timeout_ms || 30000, 1000), 120000);
    const shell = getShellCommand();
    const cmdToRun = command || `${shell} -NoProfile -Command "${task}"`;

    // Phase 8.3: Warn if command needs elevation
    if (/schtasks|netsh|sc\s+(config|start|stop)|reg\s/i.test(cmdToCheck) && !isElevated()) {
        console.warn("[CMD Control] Comando puede requerir permisos de administrador.");
    }

    console.log(`[CMD Control] Ejecutando:`, redactCmd(cmdToRun), `(timeout: ${timeoutMs}ms, bg: ${!!p?.run_in_background})`);

    // ── Background mode ──────────────────────────────────────
    if (p?.run_in_background) {
        return runBackground(cmdToRun, cwd);
    }

    // ── Foreground with timeout ──────────────────────────────
    try {
        const { stdout, stderr } = await execAsync(cmdToRun, { cwd, timeout: timeoutMs });
        let output = stdout.trim();
        const error = stderr.trim();

        if (output && output.length > 5000) {
            output = output.slice(0, 5000) + "\n...[TRUNCADO]";
        }
        if (error) {
            console.warn(`[CMD Control] stderr: ${error.slice(0, 200)}`);
            if (!output) return `Error ejecutando comando: ${error.slice(0, 2000)}`;
        }
        return output || "Comando ejecutado exitosamente sin salida de texto.";
    } catch (e: any) {
        if (e.killed) {
            return `Comando cancelado: excedió el timeout de ${timeoutMs / 1000}s.`;
        }
        console.error(`[CMD Control] Error:`, e.message);
        return `Comando falló: ${e.message}`;
    }
}

// ── Background process launcher ──────────────────────────────

let bgCounter = 0;

function runBackground(cmdToRun: string, cwd: string): string {
    const id = `bg-${++bgCounter}`;
    const child = spawn(cmdToRun, {
        shell: true,
        cwd,
        stdio: ["ignore", "pipe", "pipe"],
        detached: false,
    });

    const label = cmdToRun.slice(0, 60);
    backgroundProcesses.set(id, { pid: child.pid || 0, label, startedAt: Date.now() });

    let stdout = "";
    let stderr = "";

    child.stdout?.on("data", (chunk: Buffer) => {
        const text = chunk.toString();
        stdout += text;
        // Emit streaming chunks for CLI
        cmdEvents.emit("output", { id, type: "stdout", text });
    });

    child.stderr?.on("data", (chunk: Buffer) => {
        const text = chunk.toString();
        stderr += text;
        cmdEvents.emit("output", { id, type: "stderr", text });
    });

    child.on("close", (code) => {
        backgroundProcesses.delete(id);
        const truncOut = stdout.length > 3000 ? stdout.slice(0, 3000) + "\n...[TRUNCADO]" : stdout;
        cmdEvents.emit("done", { id, code, stdout: truncOut.trim(), stderr: stderr.trim() });
    });

    child.on("error", (err) => {
        backgroundProcesses.delete(id);
        cmdEvents.emit("done", { id, code: 1, stdout: "", stderr: err.message });
    });

    return `Proceso lanzado en segundo plano [${id}] (PID: ${child.pid || "?"}). Usa /status para verificar.`;
}

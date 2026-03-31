import { exec } from "child_process";
import { promisify } from "util";
import os from "os";

const execAsync = promisify(exec);

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

function isSafeCommand(cmd: string): boolean {
    const lower = cmd.toLowerCase();
    for (const pattern of BLOCKED_PATTERNS) {
        if (pattern.test(cmd) || pattern.test(lower)) return false;
    }
    return true;
}

export async function cmdControl(parameters: any): Promise<string> {
    const task = parameters?.task || "";
    const command = parameters?.command || "";
    
    if (!task && !command) {
        return "Se necesita una 'task' o 'command' para ejecutar.";
    }

    const cmdToCheck = command || task;
    if (!isSafeCommand(cmdToCheck)) {
        console.warn(`[CMD Control] Comando bloqueado por seguridad: ${cmdToCheck.slice(0, 100)}`);
        return "Comando bloqueado: operación potencialmente peligrosa no permitida.";
    }

    console.log(`[CMD Control] Ejecutando:`, command || task);
    try { 
//  Ejecutamos en el directorio home por defecto
const cwd = os.homedir();
    
//  Si el LLM nos dio un comando exacto lo usamos, sino generamos un comando simple
const cmdToRun = command || `powershell -NoProfile -Command "${task}"`;
    const { stdout, stderr } = await execAsync(cmdToRun, { cwd, timeout: 60000 });
    let output = stdout.trim();
    let error = stderr.trim();
    if (output && output.length > 3000) { output = output.slice(0, 3000) + "\n...[TRUNCADO]";}
if (error) { console.warn(`[CMD Control] Advertencia/Error: ${error}`);
    //  A veces powershell escribe warnings en stderr, seguimos si hay stdout
if (!output) return `Error ejecutando comando: ${error}`;}
return output || "Comando ejecutado exitosamente sin salida de texto.";}catch (e: any) { console.error(`[CMD Control] Error crítico:`, e);
    return `Comando falló: ${e.message}`;
    }
}

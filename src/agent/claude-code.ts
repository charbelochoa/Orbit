import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { buildProjectContext } from "../context/project-facts.js";
import { workspaceRoot } from "../core/workspace.js";
import { ProcessTimeoutError, waitForProcess } from "../infra/process-lifetime.js";

const execFileAsync = promisify(execFile);

export async function runClaudeCode(request: string, edit: boolean, signal?: AbortSignal): Promise<string> {
    if (process.env.ORBIT_CLAUDE_CODE !== "1") {
        throw new Error("Activa ORBIT_CLAUDE_CODE=1 en .env para usar tu instalación de Claude Code.");
    }
    signal?.throwIfAborted();
    const executable = process.env.ORBIT_CLAUDE_CODE_EXECUTABLE || (process.platform === "win32" ? "claude.exe" : "claude");
    const workspace = workspaceRoot();
    const context = await buildProjectContext();
    signal?.throwIfAborted();
    const args = [
        "-p", "--output-format", "json", "--no-session-persistence",
        "--restricted", "--safe-mode",
        "--strict-mcp-config", "--mcp-config", '{"mcpServers":{}}',
        "--disallowedTools", "mcp__*",
        "--permission-mode", edit ? "acceptEdits" : "plan",
        "--tools", edit ? "Read,Glob,Grep,Edit,Write" : "Read,Glob,Grep",
    ];
    const prompt = [
        "Responde en el idioma de la solicitud. Trabaja dentro de la carpeta seleccionada.",
        "Usa los datos del proyecto como contexto. Distingue las operaciones realizadas de las sugeridas.",
        "Datos del proyecto",
        context,
        "Solicitud",
        request,
    ].join("\n\n");

    try {
        const execution = execFileAsync(executable, args, {
            cwd: workspace,
            windowsHide: true,
            maxBuffer: 2 * 1024 * 1024,
        });
        execution.child.stdin?.on("error", () => {});
        execution.child.stdin?.end(prompt, "utf-8");
        const { stdout } = await waitForProcess(execution.child, execution, 240_000, signal);
        const result = JSON.parse(stdout);
        if (!result.is_error && typeof result.result === "string" && result.result.trim()) {
            return result.result.trim();
        }
    } catch (error) {
        signal?.throwIfAborted();
        if (error instanceof ProcessTimeoutError) throw new Error("Claude Code agotó su tiempo de ejecución.");
        if ((error as NodeJS.ErrnoException).code === "ENOENT") {
            throw new Error("No encontré Claude Code. Instálalo y autentícalo con tu cuenta, o indica el ejecutable en ORBIT_CLAUDE_CODE_EXECUTABLE.");
        }
    }
    throw new Error("Claude Code no terminó la solicitud. Comprueba su versión y autenticación local.");
}

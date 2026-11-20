import { execFile } from "node:child_process";
import { buildProjectContext } from "../context/project-facts.js";
import { workspaceRoot } from "../core/workspace.js";

export async function runClaudeCode(request: string, edit: boolean, signal?: AbortSignal): Promise<string> {
    if (process.env.ORBIT_CLAUDE_CODE !== "1") {
        throw new Error("Activa ORBIT_CLAUDE_CODE=1 en .env para usar tu instalación de Claude Code.");
    }
    const executable = process.env.ORBIT_CLAUDE_CODE_EXECUTABLE || (process.platform === "win32" ? "claude.exe" : "claude");
    const workspace = workspaceRoot();
    const context = await buildProjectContext();
    const deadline = AbortSignal.any([AbortSignal.timeout(240_000), ...(signal ? [signal] : [])]);
    deadline.throwIfAborted();
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

    return new Promise((resolve, reject) => {
        const child = execFile(executable, args, {
            cwd: workspace,
            windowsHide: true,
            maxBuffer: 2 * 1024 * 1024,
            signal: deadline,
        }, (error, stdout) => {
            if (deadline.aborted) {
                reject(deadline.reason);
                return;
            }
            if (error?.code === "ENOENT") {
                reject(new Error("No encontré Claude Code. Instálalo y autentícalo con tu cuenta, o indica el ejecutable en ORBIT_CLAUDE_CODE_EXECUTABLE."));
                return;
            }
            try {
                const result = JSON.parse(stdout);
                if (!error && !result.is_error && typeof result.result === "string" && result.result.trim()) {
                    resolve(result.result.trim());
                    return;
                }
            } catch {}
            reject(new Error("Claude Code no terminó la solicitud. Comprueba su versión y autenticación local."));
        });
        child.stdin?.on("error", () => {});
        child.stdin?.end(prompt, "utf-8");
    });
}

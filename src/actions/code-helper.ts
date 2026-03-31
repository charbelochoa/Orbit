import { exec } from "child_process";
import { promisify } from "util";
import fs from "fs/promises";
import path from "path";
import os from "os";
import { GoogleGenAI } from "@google/genai";
import dotenv from "dotenv";

dotenv.config();

const execAsync = promisify(exec);

const LANG_CONFIG: Record<string, { ext: string; runner: string }> = {
    python:     { ext: ".py",   runner: "python" },
    py:         { ext: ".py",   runner: "python" },
    javascript: { ext: ".js",   runner: "node" },
    js:         { ext: ".js",   runner: "node" },
    typescript: { ext: ".ts",   runner: "npx tsx" },
    ts:         { ext: ".ts",   runner: "npx tsx" },
    powershell: { ext: ".ps1",  runner: "powershell -File" },
    ps1:        { ext: ".ps1",  runner: "powershell -File" },
    batch:      { ext: ".bat",  runner: "cmd /c" },
    bat:        { ext: ".bat",  runner: "cmd /c" },
};

const MAX_FIX_ATTEMPTS = 3;

async function generateCode(task: string, language: string): Promise<string> {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) throw new Error("GEMINI_API_KEY missing");
    const ai = new GoogleGenAI({ apiKey });

    const response = await ai.models.generateContent({
        model: "gemini-2.5-flash-lite",
        contents: [{ role: "user", parts: [{ text:
            `Write ${language} code to: ${task} Rules: - Output ONLY the code, no explanations, no markdown fences - Include necessary imports - Make it complete and runnable - Print results to stdout` }] }],
    });

    let code = response.text || "";
    code = code.replace(/^```\w*\n?/gm, "").replace(/```$/gm, "").trim();
    return code; }

async function fixCode(code: string, error: string, language: string): Promise<string> {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) throw new Error("GEMINI_API_KEY missing");
    const ai = new GoogleGenAI({ apiKey });
    const response = await ai.models.generateContent({
        model: "gemini-2.5-flash-lite",
        contents: [{ role: "user", parts: [{ text: `Fix this ${language} code. The error was: ${error}

Code:
${code}

Output ONLY the fixed code, no explanations, no markdown fences.` }] }],
    });
    let fixed = response.text || "";
    fixed = fixed.replace(/^```\w*\n?/gm, "").replace(/```$/gm, "").trim();
    return fixed;
}

async function runCode(filePath: string, language: string): Promise<{ stdout: string; stderr: string; success: boolean }> {
    const config = LANG_CONFIG[language.toLowerCase()] || LANG_CONFIG["python"];
    const cmd = `${config.runner} "${filePath}"`;
    try {
        const { stdout, stderr } = await execAsync(cmd, { timeout: 30000, cwd: path.dirname(filePath) });
        return { stdout: stdout.trim(), stderr: stderr.trim(), success: true };
    } catch (e: any) {
        return { stdout: (e.stdout || "").trim(), stderr: (e.stderr || e.message || "").trim(), success: false };
    }
}

async function explainCode(code: string): Promise<string> {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) throw new Error("GEMINI_API_KEY missing");
    const ai = new GoogleGenAI({ apiKey });
    const response = await ai.models.generateContent({
        model: "gemini-2.5-flash-lite",
        contents: [{ role: "user", parts: [{ text: `Explain this code briefly in Spanish (2-4 sentences):\n\n${code}` }] }],
    });
    return response.text || "No pude generar una explicacion.";
}

export async function codeHelper(parameters: any): Promise<string> {
    const action   = (parameters?.action ?? "write").toLowerCase().trim();
    const language = (parameters?.language ?? "python").toLowerCase().trim();
    const task     = parameters?.task || parameters?.description || "";
    const filePath = parameters?.file_path || "";
    const autoRun  = parameters?.auto_run !== false;

    console.log(`[Code Helper] ${action} (${language})`, { task: task.slice(0, 60), filePath });
    try {
        switch (action) {
            case "write": {
                if (!task) return "Necesito una descripcion de lo que debe hacer el codigo.";
                const config = LANG_CONFIG[language] || LANG_CONFIG["python"];
                let code = await generateCode(task, language);
                const tmpDir = path.join(os.tmpdir(), "orbit_code");
                await fs.mkdir(tmpDir, { recursive: true });
                const targetPath = filePath || path.join(tmpDir, `orbit_script_${Date.now()}${config.ext}`);
                await fs.writeFile(targetPath, code, "utf-8");
                if (!autoRun) return `Codigo generado y guardado en: ${targetPath}`;
                for (let attempt = 0; attempt < MAX_FIX_ATTEMPTS; attempt++) {
                    const result = await runCode(targetPath, language);
                    if (result.success) {
                        const output = result.stdout || "(sin salida)";
                        return `Codigo ejecutado correctamente.\nArchivo: ${targetPath}\nSalida:\n${output.substring(0, 2000)}`;
                    }
                    if (attempt < MAX_FIX_ATTEMPTS - 1) {
                        console.log(`[Code Helper] Intento ${attempt + 1} fallo, corrigiendo...`);
                        code = await fixCode(code, result.stderr, language);
                        await fs.writeFile(targetPath, code, "utf-8");
                    } else {
                        return `Codigo generado pero fallo tras ${MAX_FIX_ATTEMPTS} intentos.\nArchivo: ${targetPath}\nUltimo error: ${result.stderr.substring(0, 500)}`;
                    }
                }
                return `Codigo guardado en: ${targetPath}`;
            }
            case "run": {
                if (!filePath) return "Necesito el file_path del archivo a ejecutar.";
                const result = await runCode(filePath, language);
                if (result.success) return `Ejecutado correctamente.\nSalida:\n${(result.stdout || "(sin salida)").substring(0, 2000)}`;
                return `Error al ejecutar:\n${result.stderr.substring(0, 1000)}`;
            }
            case "fix": {
                if (!filePath) return "Necesito el file_path del archivo a corregir.";
                const code = await fs.readFile(filePath, "utf-8");
                const result = await runCode(filePath, language);
                if (result.success) return "El codigo ya funciona correctamente.";
                const fixed = await fixCode(code, result.stderr, language);
                await fs.writeFile(filePath, fixed, "utf-8");
                return `Codigo corregido en: ${filePath}`;
            }
            case "explain": {
                let code = "";
                if (filePath) {
                    code = await fs.readFile(filePath, "utf-8");
                } else if (task) {
                    code = task;
                } else {
                    return "Necesito un file_path o el codigo en task para explicar.";
                }
                return await explainCode(code.substring(0, 5000));
            }
            default:
                return `Accion no reconocida: '${action}'. Opciones: write, run, fix, explain`;
        }
    } catch (e: any) {
        console.error(`[Code Helper] `, e);
        return `Error en code_helper: ${e.message}`;
    }
}

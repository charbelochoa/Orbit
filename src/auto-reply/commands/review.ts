/**
 * /review — Pide al modelo que haga code review del diff actual
 *
 * Tipo "prompt": inyecta el git diff como contexto y pide review.
 */
import { execSync } from "child_process";
import type { CommandHandler } from "../types.js";

export const reviewCommand: CommandHandler = async (ctx) => {
    let diff: string;
    try {
        diff = execSync("git diff", { encoding: "utf-8", maxBuffer: 512 * 1024 }).trim();
        if (!diff) {
            diff = execSync("git diff --staged", { encoding: "utf-8", maxBuffer: 512 * 1024 }).trim();
        }
    } catch {
        return "⚠ No estás en un repositorio git o no hay cambios.";
    }

    if (!diff) {
        return "No hay cambios para revisar (ni unstaged ni staged).";
    }

    // Truncate very large diffs
    const maxLen = 8000;
    const truncated = diff.length > maxLen ? diff.slice(0, maxLen) + "\n... (diff truncado)" : diff;

    // Send as a regular chat message so the model processes it
    const prompt = [
        "Haz un code review detallado del siguiente git diff.",
        "Enfócate en: bugs potenciales, seguridad, legibilidad, performance, mejores prácticas.",
        "Responde en español. Formato: lista los archivos modificados y da feedback archivo por archivo.",
        "",
        "```diff",
        truncated,
        "```",
    ].join("\n");

    // Forward to the model as a user message
    if (ctx.speakFn) {
        ctx.speakFn(prompt);
    }
    return undefined; // the model will respond via normal streaming
};

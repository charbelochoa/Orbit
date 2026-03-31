/**
 * /diff — Muestra el git diff del proyecto actual
 */
import { execSync } from "child_process";
import type { CommandHandler } from "../types.js";

export const diffCommand: CommandHandler = async (ctx) => {
    const arg = ctx.argStr.trim(); // optional: --staged, filename, etc.

    try {
        // Check if we're in a git repo
        execSync("git rev-parse --is-inside-work-tree", { stdio: "pipe" });
    } catch {
        return "⚠ No estás dentro de un repositorio git.";
    }

    try {
        const gitArgs = arg || "";
        const stat = execSync(`git diff --stat ${gitArgs}`, { encoding: "utf-8", maxBuffer: 1024 * 1024 }).trim();

        if (!stat) {
            // Try staged
            const staged = execSync(`git diff --staged --stat`, { encoding: "utf-8", maxBuffer: 1024 * 1024 }).trim();
            if (!staged) {
                return "No hay cambios (ni staged ni unstaged).";
            }
            const stagedDiff = execSync(`git diff --staged`, { encoding: "utf-8", maxBuffer: 512 * 1024 }).trim();
            return `**Cambios staged:**\n\`\`\`diff\n${truncate(stagedDiff, 4000)}\n\`\`\`\n\n${staged}`;
        }

        const diff = execSync(`git diff ${gitArgs}`, { encoding: "utf-8", maxBuffer: 512 * 1024 }).trim();
        return `**Git diff${arg ? ` (${arg})` : ""}:**\n\`\`\`diff\n${truncate(diff, 4000)}\n\`\`\`\n\n${stat}`;
    } catch (e: any) {
        return `⚠ Error ejecutando git diff: ${e.message}`;
    }
};

function truncate(s: string, max: number): string {
    if (s.length <= max) return s;
    return s.slice(0, max) + "\n... (truncado)";
}

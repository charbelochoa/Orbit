import { runClaudeCode } from "../../agent/claude-code.js";
import type { CommandHandler } from "../types.js";

export const claudeCommand: CommandHandler = async context => {
    const argument = context.rawText.replace(/^\/claude(?:\s+|$)/i, "").trim();
    const edit = /^--edit(?:\s|$)/.test(argument);
    const request = (edit ? argument.replace(/^--edit(?:\s|$)/, "") : argument).trim();
    if (!request) return "Uso: /claude [--edit] <solicitud>";
    return runClaudeCode(request, edit, context.signal);
};

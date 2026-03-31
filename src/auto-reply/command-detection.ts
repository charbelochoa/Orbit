/**
 * Orbit Command Detection — Phase 6
 * Parses /command messages from the chat.
 */

export interface ParsedCommand {
    name:       string;
    subcommand: string;
    argStr:     string;
    args:       string[];
}

export function isCommand(text: string): boolean {
    return text.trim().startsWith("/");
}

export function parseCommand(text: string): ParsedCommand | null {
    const trimmed = text.trim();
    if (!trimmed.startsWith("/")) return null;

    // Split on whitespace: /cmd sub arg1 arg2 ...
    const parts = trimmed.slice(1).split(/\s+/);
    const name       = parts[0]?.toLowerCase() ?? "";
    const subcommand = parts[1]?.toLowerCase() ?? "";
    const argStr     = parts.slice(2).join(" ");
    const args       = parts.slice(1);           // everything after the cmd name

    if (!name) return null;
    return { name, subcommand, argStr, args };
}

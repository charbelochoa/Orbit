/**
 * Orbit Reply Dispatcher — Phase 6
 * Maintains the command registry and routes /commands to their handlers.
 * Also controls the typing indicator state while commands execute.
 */

import { WebSocket }            from "ws";
import { setTypingState }       from "../gateway/server.js";
import { parseCommand }         from "./command-detection.js";
import { createLogger }         from "../infra/logger.js";
import type { CommandDef, CommandContext } from "./types.js";

const log = createLogger("Dispatcher");

// ── Command Registry ──────────────────────────────────────────────────────────

class CommandRegistryClass {
    private readonly _defs  = new Map<string, CommandDef>();
    private readonly _names = new Set<string>();   // original names (no aliases)

    register(def: CommandDef): void {
        this._names.add(def.name);
        this._defs.set(def.name, def);
        for (const alias of def.aliases ?? []) {
            this._defs.set(alias, def);
        }
    }

    get(name: string): CommandDef | undefined {
        return this._defs.get(name);
    }

    /** Returns one entry per command (deduplicated aliases). */
    getAll(): CommandDef[] {
        return Array.from(this._names)
            .map(n => this._defs.get(n)!)
            .filter(Boolean);
    }
}

export const commandRegistry = new CommandRegistryClass();

// ── Dispatcher ────────────────────────────────────────────────────────────────

/**
 * Try to dispatch `text` as a /command.
 * Returns `true` if the text was a command (handled or unknown), `false` otherwise.
 */
export async function dispatchCommand(
    text:     string,
    clientId: string,
    ws:       WebSocket,
    speakFn?: (text: string) => void,
): Promise<boolean> {
    const parsed = parseCommand(text);
    if (!parsed) return false;

    const def = commandRegistry.get(parsed.name);
    if (!def) {
        ws.send(JSON.stringify({
            type:    "command_error",
            message: `Comando desconocido: /${parsed.name}. Escribe /help para ver los comandos disponibles.`,
        }));
        return true;
    }

    const ctx: CommandContext = {
        clientId,
        sendReply:  (msg) => ws.send(JSON.stringify(msg)),
        speakFn,
        rawText:    text,
        args:       parsed.args,
        subcommand: parsed.subcommand,
        argStr:     parsed.argStr,
    };

    setTypingState("thinking");
    try {
        const result = await def.handler(ctx);
        if (typeof result === "string" && result.trim()) {
            ws.send(JSON.stringify({
                type:    "command_result",
                command: parsed.name,
                message: result,
            }));
        }
    } catch (e: any) {
        log.error(`Error en comando /${parsed.name}:`, e.message);
        ws.send(JSON.stringify({
            type:    "command_error",
            message: `Error ejecutando /${parsed.name}: ${e.message}`,
        }));
    } finally {
        setTypingState("idle");
    }
    return true;
}

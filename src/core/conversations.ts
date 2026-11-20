import { createHash, randomUUID } from "node:crypto";

export function isConversationId(value: unknown): value is string {
    return typeof value === "string" && /^[\w-]{1,100}$/.test(value);
}

export function chatSessionId(id: string): string {
    return `chat:${id}`;
}

export function selectConversationId(workspace: string, id?: string, name?: string): string {
    if (id !== undefined && name !== undefined) throw new Error("Elige --session o --conversation.");
    if (id !== undefined) {
        if (!isConversationId(id)) throw new Error("El identificador de conversación no es válido.");
        return id;
    }
    if (name !== undefined) {
        if (!name.trim() || name.length > 100) throw new Error("El nombre de sesión debe tener de 1 a 100 caracteres.");
        return "cli_" + createHash("sha256").update(workspace).update("\0").update(name).digest("hex");
    }
    return randomUUID();
}

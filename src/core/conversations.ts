import { createHash } from "node:crypto";

export function isConversationId(value: unknown): value is string {
    return typeof value === "string" && /^[\w-]{1,100}$/.test(value);
}

export function chatSessionId(id: string): string {
    return `chat:${id}`;
}

export function namedConversationId(workspace: string, name: string): string {
    return "cli_" + createHash("sha256").update(workspace).update("\0").update(name).digest("hex");
}

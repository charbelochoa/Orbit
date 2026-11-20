import { listChatConversations } from "../../memory/chat-history.js";
import type { CommandHandler } from "../types.js";

export const sessionsCommand: CommandHandler = async () => {
    const chats = listChatConversations().slice(0, 20);
    if (!chats.length) return "Aún no hay conversaciones guardadas.";
    return [
        "**Conversaciones recientes**",
        ...chats.map(chat => `- \`${chat.id}\` ${chat.title}`),
        "Usa `orbit chat --conversation <id>` para retomar una en la terminal.",
    ].join("\n");
};

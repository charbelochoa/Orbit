import { APP_DATA } from "../config/paths.js";
import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import fs from "node:fs";
import { inTransaction } from "./sqlite.js";
import { chatSessionId, isConversationId } from "../core/conversations.js";

type MessageRole = "user" | "assistant";

interface MessageRow {
    id: number;
    role: MessageRole;
    content: string;
    timestamp: string;
}

interface ConversationRow {
    session_id: string;
    workspace: string | null;
    first_at: string;
    last_at: string;
    first_user: string | null;
    preview: string;
    last_id: number;
}

fs.mkdirSync(APP_DATA, { recursive: true });
const db = new DatabaseSync(path.join(APP_DATA, "history.db"));
db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA busy_timeout = 2000;
    CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        timestamp TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_session ON messages (session_id);
    CREATE TABLE IF NOT EXISTS chat_workspaces (
        session_id TEXT PRIMARY KEY,
        workspace TEXT NOT NULL
    );
`);

const insertMessage = db.prepare("INSERT INTO messages (session_id, role, content, timestamp) VALUES (?, ?, ?, ?)");

function timeMillis(timestamp: string): number {
    return Date.parse(timestamp.includes("T") ? timestamp : timestamp.replace(" ", "T") + "Z") || 0;
}

export function addMessage(sessionId: string, role: MessageRole, content: string): void {
    insertMessage.run(sessionId, role, content, new Date().toISOString());
}

export function saveChatTurn(sessionId: string, workspace: string, user: string, assistant: string): void {
    if (!user && !assistant) return;
    inTransaction(db, () => {
        if (user) addMessage(sessionId, "user", user);
        if (assistant) addMessage(sessionId, "assistant", assistant);
        db.prepare(`
            INSERT INTO chat_workspaces (session_id, workspace) VALUES (?, ?)
            ON CONFLICT (session_id) DO UPDATE SET workspace = excluded.workspace
        `).run(sessionId, workspace);
    });
}

function messageRows(sessionId: string, limit: number): MessageRow[] {
    return db.prepare(`
        SELECT id, role, content, timestamp FROM messages
        WHERE session_id = ? ORDER BY id DESC LIMIT ?
    `).all(sessionId, limit).reverse() as unknown as MessageRow[];
}

export function getHistory(sessionId: string, limit = 40): Array<{ role: string; content: string }> {
    return messageRows(sessionId, limit).map(({ role, content }) => ({ role, content }));
}

export function getChatWorkspace(conversationId: string): string | undefined {
    const row = db.prepare("SELECT workspace FROM chat_workspaces WHERE session_id = ?").get(chatSessionId(conversationId));
    return typeof row?.workspace === "string" ? row.workspace : undefined;
}

export function readChatConversation(conversationId: string) {
    const messages = messageRows(chatSessionId(conversationId), 80).map(({ id, role, content, timestamp }) => ({
        id, role, content, ts: timeMillis(timestamp),
    }));
    return { conversationId, workspace: getChatWorkspace(conversationId), messages };
}

export function listChatConversations() {
    const rows = db.prepare(`
        WITH recent AS (
            SELECT session_id, min(id) AS first_id, max(id) AS last_id
            FROM messages WHERE session_id GLOB 'chat:*'
            GROUP BY session_id ORDER BY last_id DESC LIMIT 100
        )
        SELECT recent.session_id, recent.last_id, workspace.workspace,
            first_message.timestamp AS first_at, last_message.timestamp AS last_at, substr(last_message.content, 1, 120) AS preview,
            (SELECT substr(content, 1, 140) FROM messages
                WHERE session_id = recent.session_id AND role = 'user' ORDER BY id LIMIT 1) AS first_user
        FROM recent
        JOIN messages first_message ON first_message.id = recent.first_id
        JOIN messages last_message ON last_message.id = recent.last_id
        LEFT JOIN chat_workspaces workspace ON workspace.session_id = recent.session_id
        ORDER BY recent.last_id DESC
    `).all() as unknown as ConversationRow[];
    return rows.map(row => ({
        id: row.session_id.slice("chat:".length),
        title: row.first_user?.trim().replace(/\s+/g, " ").slice(0, 80) || "Conversación de Orbit",
        workspace: row.workspace ?? undefined,
        createdAt: timeMillis(row.first_at),
        updatedAt: timeMillis(row.last_at),
        preview: row.preview,
        lastMessageId: row.last_id,
    })).filter(conversation => isConversationId(conversation.id));
}

export function clearHistory(sessionId: string): void {
    inTransaction(db, () => {
        db.prepare("DELETE FROM messages WHERE session_id = ?").run(sessionId);
        db.prepare("DELETE FROM chat_workspaces WHERE session_id = ?").run(sessionId);
    });
}

export function getAllSessions(): string[] {
    const rows = db.prepare("SELECT session_id FROM messages GROUP BY session_id ORDER BY max(id) DESC").all();
    return rows.map(row => String(row.session_id));
}

import Database from "better-sqlite3";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.join(__dirname, "../../data/history.db");

// Asegurar que el directorio existe
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new Database(DB_PATH);

// Crear tabla si no existe
db.exec(` CREATE TABLE IF NOT EXISTS messages ( id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT NOT NULL, role TEXT NOT NULL, content TEXT NOT NULL, timestamp TEXT NOT NULL DEFAULT (datetime('now')) ); CREATE INDEX IF NOT EXISTS idx_session ON messages (session_id);
`);

export function addMessage(sessionId: string, role: "user" | "assistant", content: string): void {
    db.prepare(
        `INSERT INTO messages (session_id, role, content) VALUES (?, ?, ?)` ).run(sessionId, role, content);
} export function getHistory(sessionId: string, limit: number = 40): Array<{ role: string; content: string }> { return db.prepare( `SELECT role, content FROM messages WHERE session_id = ? ORDER BY id DESC LIMIT ?` ).all(sessionId, limit).reverse() as Array<{ role: string; content: string }>;
} export function clearHistory(sessionId: string): void { db.prepare(`DELETE FROM messages WHERE session_id = ?`).run(sessionId); console.log(`[Chat History] Historial de sesión ${sessionId} borrado.`);
} export function getAllSessions(): string[] { const rows = db.prepare(`SELECT DISTINCT session_id FROM messages ORDER BY id DESC`).all() as { session_id: string }[];
    return rows.map(r => r.session_id);
}

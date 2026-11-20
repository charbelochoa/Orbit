import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { APP_DATA } from "../config/paths.js";
import type { Task } from "./task-queue.js";

type TaskRow = Pick<Task, "id" | "goal" | "workspace" | "priority" | "status"> & {
    created_at: number;
    started_at: number | null;
    ended_at: number | null;
    output: string;
    result: string | null;
    error: string | null;
};

export class TaskStore {
    private readonly database: DatabaseSync;

    constructor() {
        fs.mkdirSync(APP_DATA, { recursive: true });
        this.database = new DatabaseSync(path.join(APP_DATA, "tasks.db"));
        this.database.exec(`
            PRAGMA journal_mode = WAL;
            PRAGMA busy_timeout = 2000;
            CREATE TABLE IF NOT EXISTS tasks (
                id TEXT PRIMARY KEY,
                goal TEXT NOT NULL,
                workspace TEXT NOT NULL,
                priority INTEGER NOT NULL,
                status TEXT NOT NULL,
                created_at INTEGER NOT NULL,
                started_at INTEGER,
                ended_at INTEGER,
                output TEXT NOT NULL,
                result TEXT,
                error TEXT
            );
        `);
    }

    recover(): Task[] {
        this.database.prepare(`
            UPDATE tasks SET status = 'failed', ended_at = ?, error = ?
            WHERE status IN ('running', 'paused')
        `).run(Date.now(), "Orbit se cerró durante la ejecución. Revisa el progreso antes de reintentar.");
        const rows = this.database.prepare("SELECT * FROM tasks ORDER BY created_at, id").all() as unknown as TaskRow[];
        return rows.map(row => ({
            id: row.id,
            goal: row.goal,
            workspace: row.workspace,
            priority: row.priority,
            status: row.status,
            createdAt: new Date(row.created_at),
            startedAt: row.started_at ? new Date(row.started_at) : undefined,
            endedAt: row.ended_at ? new Date(row.ended_at) : undefined,
            output: JSON.parse(row.output),
            result: row.result ?? undefined,
            error: row.error ?? undefined,
        }));
    }

    save(task: Task): void {
        this.database.prepare(`
            INSERT INTO tasks (id, goal, workspace, priority, status, created_at, started_at, ended_at, output, result, error)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT (id) DO UPDATE SET status = excluded.status, started_at = excluded.started_at,
                ended_at = excluded.ended_at, output = excluded.output, result = excluded.result, error = excluded.error
        `).run(
            task.id, task.goal, task.workspace, task.priority, task.status, task.createdAt.getTime(),
            task.startedAt?.getTime() ?? null, task.endedAt?.getTime() ?? null, JSON.stringify(task.output),
            task.result ?? null, task.error ?? null,
        );
    }

    delete(id: string): void {
        this.database.prepare("DELETE FROM tasks WHERE id = ?").run(id);
    }
}

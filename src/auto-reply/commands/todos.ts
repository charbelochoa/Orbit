/**
 * /todos — Gestión de tareas inline
 *
 * /todos              — lista todas las tareas
 * /todos add <texto>  — añade una tarea
 * /todos done <id>    — marca como completada
 * /todos rm <id>      — elimina una tarea
 * /todos clear        — elimina todas las completadas
 */
import fs from "fs";
import path from "path";
import type { CommandHandler } from "../types.js";

interface TodoItem {
    id:      number;
    text:    string;
    status:  "pending" | "in_progress" | "completed";
    created: string;
}

function getTodosPath(): string {
    const dir = path.join(process.cwd(), ".orbit");
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    return path.join(dir, "todos.json");
}

function loadTodos(): TodoItem[] {
    const p = getTodosPath();
    if (!fs.existsSync(p)) return [];
    try {
        return JSON.parse(fs.readFileSync(p, "utf-8"));
    } catch {
        return [];
    }
}

function saveTodos(todos: TodoItem[]): void {
    fs.writeFileSync(getTodosPath(), JSON.stringify(todos, null, 2));
}

function nextId(todos: TodoItem[]): number {
    return todos.length === 0 ? 1 : Math.max(...todos.map(t => t.id)) + 1;
}

function renderList(todos: TodoItem[]): string {
    if (todos.length === 0) return "No hay tareas. Usa `/todos add <texto>` para crear una.";

    const lines = ["**Tareas:**\n"];
    for (const t of todos) {
        const icon = t.status === "completed" ? "✓"
                   : t.status === "in_progress" ? "●"
                   : "○";
        const strike = t.status === "completed" ? "~~" : "";
        lines.push(`  ${icon} **#${t.id}** ${strike}${t.text}${strike}`);
    }
    const done = todos.filter(t => t.status === "completed").length;
    const total = todos.length;
    lines.push(`\n  ${done}/${total} completadas`);
    return lines.join("\n");
}

export const todosCommand: CommandHandler = async (ctx) => {
    const sub = ctx.subcommand.toLowerCase();
    const todos = loadTodos();

    if (!sub || sub === "list") {
        return renderList(todos);
    }

    if (sub === "add") {
        const text = ctx.argStr.trim();
        if (!text) return "Uso: `/todos add <descripción de la tarea>`";
        const item: TodoItem = {
            id:      nextId(todos),
            text,
            status:  "pending",
            created: new Date().toISOString(),
        };
        todos.push(item);
        saveTodos(todos);
        return `✓ Tarea **#${item.id}** creada: ${text}`;
    }

    if (sub === "done" || sub === "complete") {
        const id = parseInt(ctx.args[1], 10);
        const item = todos.find(t => t.id === id);
        if (!item) return `⚠ Tarea #${id} no encontrada.`;
        item.status = "completed";
        saveTodos(todos);
        return `✓ Tarea **#${id}** completada: ~~${item.text}~~`;
    }

    if (sub === "wip" || sub === "start") {
        const id = parseInt(ctx.args[1], 10);
        const item = todos.find(t => t.id === id);
        if (!item) return `⚠ Tarea #${id} no encontrada.`;
        item.status = "in_progress";
        saveTodos(todos);
        return `● Tarea **#${id}** en progreso: ${item.text}`;
    }

    if (sub === "rm" || sub === "remove" || sub === "delete") {
        const id = parseInt(ctx.args[1], 10);
        const idx = todos.findIndex(t => t.id === id);
        if (idx === -1) return `⚠ Tarea #${id} no encontrada.`;
        const removed = todos.splice(idx, 1)[0];
        saveTodos(todos);
        return `✗ Tarea **#${id}** eliminada: ${removed.text}`;
    }

    if (sub === "clear") {
        const remaining = todos.filter(t => t.status !== "completed");
        const cleared = todos.length - remaining.length;
        saveTodos(remaining);
        return cleared > 0
            ? `✓ ${cleared} tarea${cleared > 1 ? "s" : ""} completada${cleared > 1 ? "s" : ""} eliminada${cleared > 1 ? "s" : ""}.`
            : "No hay tareas completadas para limpiar.";
    }

    return "Subcomandos: `list`, `add <texto>`, `done <id>`, `wip <id>`, `rm <id>`, `clear`";
};

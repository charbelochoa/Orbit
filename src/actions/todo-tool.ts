/**
 * todo_tool — Agent-facing todo read/write tools.
 * Syncs with the same .orbit/todos.json used by /todos slash command.
 */
import fs from "fs";
import path from "path";

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

export async function todoRead(): Promise<string> {
    const todos = loadTodos();
    if (todos.length === 0) return "No hay tareas registradas.";

    const lines = todos.map(t => {
        const icon = t.status === "completed" ? "✓" : t.status === "in_progress" ? "●" : "○";
        return `  ${icon} [${t.id}] ${t.text} (${t.status})`;
    });
    return `Tareas (${todos.length}):\n${lines.join("\n")}`;
}

export interface TodoWriteParams {
    action:  "add" | "update" | "complete" | "delete";
    text?:   string;
    id?:     number;
    status?: "pending" | "in_progress" | "completed";
}

export async function todoWrite(parameters: any): Promise<string> {
    const p = parameters as TodoWriteParams;
    if (!p?.action) return "Se necesita 'action' (add|update|complete|delete).";

    const todos = loadTodos();

    switch (p.action) {
        case "add": {
            if (!p.text) return "Se necesita 'text' para añadir una tarea.";
            const id = todos.length > 0 ? Math.max(...todos.map(t => t.id)) + 1 : 1;
            todos.push({ id, text: p.text, status: p.status || "pending", created: new Date().toISOString() });
            saveTodos(todos);
            return `✓ Tarea #${id} creada: ${p.text}`;
        }
        case "update": {
            if (!p.id) return "Se necesita 'id' para actualizar.";
            const t = todos.find(t => t.id === p.id);
            if (!t) return `Tarea #${p.id} no encontrada.`;
            if (p.text) t.text = p.text;
            if (p.status) t.status = p.status;
            saveTodos(todos);
            return `✓ Tarea #${p.id} actualizada.`;
        }
        case "complete": {
            if (!p.id) return "Se necesita 'id' para completar.";
            const t = todos.find(t => t.id === p.id);
            if (!t) return `Tarea #${p.id} no encontrada.`;
            t.status = "completed";
            saveTodos(todos);
            return `✓ Tarea #${p.id} completada: ${t.text}`;
        }
        case "delete": {
            if (!p.id) return "Se necesita 'id' para eliminar.";
            const idx = todos.findIndex(t => t.id === p.id);
            if (idx === -1) return `Tarea #${p.id} no encontrada.`;
            const removed = todos.splice(idx, 1)[0];
            saveTodos(todos);
            return `✓ Tarea #${p.id} eliminada: ${removed.text}`;
        }
        default:
            return `Acción desconocida: '${p.action}'. Usa add|update|complete|delete.`;
    }
}

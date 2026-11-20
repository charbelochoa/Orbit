import { AsyncLocalStorage } from "node:async_hooks";
import { realpath, stat } from "node:fs/promises";
import path from "node:path";

const workspaces = new AsyncLocalStorage<string>();

export function workspaceRoot(): string {
    return workspaces.getStore() ?? process.cwd();
}

export function withWorkspace<T>(root: string, operation: () => T): T {
    return workspaces.run(root, operation);
}

export async function resolveWorkspace(requested: unknown): Promise<string> {
    if (requested === undefined || requested === null) return workspaceRoot();
    if (typeof requested !== "string" || requested.length > 4096 || !path.isAbsolute(requested)) {
        throw new Error("Elige una carpeta con una ruta absoluta.");
    }
    try {
        const resolved = await realpath(requested);
        if ((await stat(resolved)).isDirectory()) return resolved;
    } catch {}
    throw new Error("Orbit no pudo abrir la carpeta seleccionada.");
}

export function isWithin(root: string, target: string): boolean {
    const relative = path.relative(root, target);
    return relative === "" || (relative !== ".." && !relative.startsWith(".." + path.sep) && !path.isAbsolute(relative));
}

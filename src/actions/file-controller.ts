import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { resolveFilePath, withFileMutation, writeFileAtomically } from "../core/file-access.js";
import { workspaceRoot } from "../core/workspace.js";

const shortcuts: Record<string, string> = {
    desktop: path.join(os.homedir(), "Desktop"),
    documents: path.join(os.homedir(), "Documents"),
    downloads: path.join(os.homedir(), "Downloads"),
    home: os.homedir(),
};

export async function fileController(parameters: Record<string, unknown>): Promise<string> {
    const action = typeof parameters?.action === "string" ? parameters.action.trim().toLowerCase() : "";
    const requested = typeof parameters?.path === "string" ? parameters.path : "";
    const shortcut = requested.toLowerCase();
    const target = await resolveFilePath(Object.hasOwn(shortcuts, shortcut) ? shortcuts[shortcut] : requested || workspaceRoot());

    switch (action) {
        case "list": {
            const files = await fs.readdir(target, { withFileTypes: true });
            const lines = files.slice(0, 500).map(entry => `[${entry.isDirectory() ? "DIR" : "FILE"}] ${entry.name}`);
            return `Contenido de ${target}:\n${lines.join("\n") || "(Carpeta vacía)"}`;
        }
        case "read": {
            const file = await fs.open(target, "r");
            try {
                if (!(await file.stat()).isFile()) throw new Error("La ruta no es un archivo.");
                const { bytesRead, buffer } = await file.read(Buffer.alloc(16_385), 0, 16_385, 0);
                const text = buffer.subarray(0, Math.min(bytesRead, 16_384)).toString("utf-8");
                return `=== ${path.basename(target)} ===\n${text}${bytesRead > 16_384 ? "\n[Contenido truncado]" : ""}`;
            } finally {
                await file.close();
            }
        }
        case "write":
        case "create_file": {
            const info = await fs.stat(target).catch(error => {
                if (error.code === "ENOENT") return undefined;
                throw error;
            });
            const name = typeof parameters.name === "string" ? parameters.name : "";
            const destination = info?.isDirectory() && name
                ? await resolveFilePath(path.resolve(target, name))
                : target;
            const content = typeof parameters.content === "string" ? parameters.content : "";
            await withFileMutation([destination], () => writeFileAtomically(destination, content));
            return `Archivo guardado en ${destination}.`;
        }
        case "delete": {
            if (!requested || Object.hasOwn(shortcuts, requested.toLowerCase()) || target === workspaceRoot()) {
                throw new Error("Indica un archivo o subcarpeta para eliminar.");
            }
            await withFileMutation([target], async () => {
                const info = await fs.lstat(target);
                if (info.isDirectory()) await fs.rm(target, { recursive: true });
                else await fs.unlink(target);
            });
            return `Eliminado: ${target}`;
        }
        case "move":
        case "copy": {
            if (typeof parameters.destination !== "string" || !parameters.destination.trim()) {
                throw new Error("Indica el destino.");
            }
            const destination = await resolveFilePath(parameters.destination);
            await withFileMutation([target, destination], async () => {
                if (action === "move") await fs.rename(target, destination);
                else await fs.cp(target, destination, { recursive: true });
            });
            return `${action === "move" ? "Movido" : "Copiado"} a ${destination}.`;
        }
        case "find": {
            const name = typeof parameters.name === "string" ? parameters.name.toLowerCase() : "";
            const extension = typeof parameters.extension === "string" ? parameters.extension.toLowerCase() : "";
            if (!name && !extension) throw new Error("Indica el nombre o la extensión.");
            const matches: string[] = [];
            await findFiles(target, name, extension, matches, 3);
            return matches.length ? matches.join("\n") : `No se encontraron archivos en ${target}.`;
        }
        default:
            throw new Error("Indica una acción de archivo válida.");
    }
}

async function findFiles(dir: string, name: string, extension: string, matches: string[], depth: number): Promise<void> {
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
        if (matches.length >= 20) return;
        const file = path.join(dir, entry.name);
        if (depth > 0 && entry.isDirectory() && !entry.name.startsWith(".")) {
            await findFiles(file, name, extension, matches, depth - 1);
        } else if (entry.isFile()) {
            const label = entry.name.toLowerCase();
            if (label.includes(name) && label.endsWith(extension)) matches.push(file);
        }
    }
}

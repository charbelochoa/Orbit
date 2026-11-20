import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { getConfig } from "../config/config.js";
import { normalizePath } from "./path-utils.js";
import { isWithin, workspaceRoot } from "./workspace.js";

export async function resolveFilePath(input: string): Promise<string> {
    const target = normalizePath(input);
    const roots = [
        workspaceRoot(),
        path.join(os.homedir(), "Desktop"),
        path.join(os.homedir(), "Downloads"),
        path.join(os.homedir(), "Documents"),
        os.tmpdir(),
        ...getConfig().security.allowedPaths.map(normalizePath),
    ].filter(Boolean);
    const realTarget = await resolveExistingAncestor(target);
    for (const root of roots) {
        let realRoot: string;
        try {
            realRoot = await fs.realpath(root);
        } catch {
            continue;
        }
        if ((isWithin(root, target) || isWithin(realRoot, target)) && isWithin(realRoot, realTarget)) {
            return target;
        }
    }
    throw new Error(`La ruta está fuera de las carpetas permitidas: ${target}`);
}

async function resolveExistingAncestor(target: string): Promise<string> {
    if (!target) throw new Error("Indica una ruta.");
    let ancestor = target;
    const names: string[] = [];
    for (;;) {
        try {
            return path.join(await fs.realpath(ancestor), ...names);
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
            const parent = path.dirname(ancestor);
            if (parent === ancestor) throw error;
            names.unshift(path.basename(ancestor));
            ancestor = parent;
        }
    }
}

export async function writeFileAtomically(target: string, content: string): Promise<void> {
    let mode: number | undefined;
    try {
        const current = await fs.lstat(target);
        if (!current.isFile()) throw new Error("El destino debe ser un archivo normal.");
        mode = current.mode & 0o777;
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    const temporary = path.join(path.dirname(target), ".orbit-write-" + randomUUID());
    try {
        await fs.writeFile(temporary, content, { encoding: "utf-8", flag: "wx", mode });
        await fs.rename(temporary, target);
    } finally {
        await fs.unlink(temporary).catch(() => {});
    }
}

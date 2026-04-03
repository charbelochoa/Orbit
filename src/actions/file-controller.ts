import fs from "fs/promises";
import path from "path";
import os from "os";
import { normalizePath } from "../core/path-utils.js";

// ── Security: allowed base directories ────────────────────────────
const ALLOWED_ROOTS = new Set([
    path.resolve(process.cwd()),
    path.resolve(os.homedir(), "Desktop"),
    path.resolve(os.homedir(), "Downloads"),
    path.resolve(os.homedir(), "Documents"),
    path.resolve(os.tmpdir()),
]);

/**
 * Validate that a resolved path is within an allowed root.
 * Returns null if safe, or the error message if blocked.
 */
function validatePath(resolved: string): string | null {
    for (const root of ALLOWED_ROOTS) {
        if (resolved === root || resolved.startsWith(root + path.sep)) return null;
    }
    return `Acceso bloqueado: la ruta '${resolved}' está fuera de los directorios permitidos.`;
}

export async function fileController(parameters: any): Promise<string> {
    const action = parameters?.action?.toLowerCase().trim() || "";
    if (!action) return "Please specify an action (list, read, write, create_file, delete, move, copy, find).";

    console.log(`[File Controller] Action: ${action} | Params:`, parameters);
    try { let targetPath = parameters.path || "";
    //  Resolve shortcuts
if (targetPath.toLowerCase() === "desktop") targetPath = path.join(os.homedir(), "Desktop");
    else if (targetPath.toLowerCase() === "downloads") targetPath = path.join(os.homedir(), "Downloads");
    else if (targetPath.toLowerCase() === "documents") targetPath = path.join(os.homedir(), "Documents");
    else if (targetPath.toLowerCase() === "home" || !targetPath) targetPath = os.homedir();
    //  Resolve absolute path targetPath = normalizePath(targetPath);

    // Security: path traversal guard
    const pathErr = validatePath(targetPath);
    if (pathErr) return pathErr;
switch (action) { case "list": { const files = await fs.readdir(targetPath, { withFileTypes: true });
    const list = files.map(f => `${f.isDirectory() ? '[DIR]' : '[FILE]'} ${f.name}`).join("\n");
    return `Contenido de ${targetPath}:\n${list || "(Carpeta vacía)"}`; } case "read": { const content = await fs.readFile(targetPath, "utf-8");
    return `=== ${path.basename(targetPath)} ===\n${content.slice(0, 4000)}${content.length > 4000 ? '\n...[TRUNCATED]' : ''}`;}
case "write": 
case "create_file": { let content = parameters.content || "";
    let filename = parameters.name || "";
    let writePath = targetPath;
    try { const stats = await fs.stat(targetPath);
    if (stats.isDirectory() && filename) { writePath = path.join(targetPath, filename); } } catch (e) { 
// Path probably doesn't exist, we will create it as file
    }
    await fs.writeFile(writePath, content, "utf-8");
    return `Archivo guardado exitosamente en: ${writePath}`;
}
case "delete": {
    const stats = await fs.stat(targetPath);
    if (stats.isDirectory()) {
        await fs.rm(targetPath, { recursive: true, force: true });
    } else {
        await fs.unlink(targetPath);
    }
    return `Eliminado: ${targetPath}`;
}
case "move": 
case "copy": { const dest = path.resolve(parameters.destination || "");
    if (!dest) return "Destino requerido para move/copy.";
    if (action === "copy") { await fs.cp(targetPath, dest, { recursive: true });
    return `Copiado a: ${dest}`; } else { await fs.rename(targetPath, dest);
    return `Movido a: ${dest}`; } } case "find": { const nameToFind = parameters.name?.toLowerCase() || "";
    const extToFind = parameters.extension?.toLowerCase() || "";
    if (!nameToFind && !extToFind) return "Especifica 'name' o 'extension' para buscar.";
    const results: string[] = [];
    async function searchRecursive(dir: string, depth = 0) { if (depth > 3) return;
    //  limit depth searching
if (results.length >= 20) return;
    //  limit results
try { const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) { const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory() && !entry.name.startsWith('.')) { await searchRecursive(fullPath, depth + 1);}else if (entry.isFile()) { const mName = !nameToFind || entry.name.toLowerCase().includes(nameToFind);
    const mExt = !extToFind || entry.name.toLowerCase().endsWith(extToFind);
    if (mName && mExt) results.push(fullPath); } } } catch(e) {} } await searchRecursive(targetPath);
    return results.length > 0 ? `Encontrados:\n${results.join("\n")}` : `No se encontraron archivos en ${targetPath}`;}
default: return `Unknown file action: ${action}`;} }catch (e: any) { console.error(`[File Controller] Error:`, e);
    return `File operation failed: ${e.message}`;
    }
}

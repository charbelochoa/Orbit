/**
 * file_edit — Surgical file editing (old_string → new_string).
 * Safer and more token-efficient than rewriting entire files.
 */
import fs from "fs";
import path from "path";
import { normalizePath } from "../core/path-utils.js";

export interface FileEditParams {
    file_path:    string;
    old_string:   string;
    new_string:   string;
    replace_all?: boolean;
}

export async function fileEdit(parameters: any): Promise<string> {
    const p = parameters as FileEditParams;
    if (!p?.file_path) return "Se necesita 'file_path'.";
    if (typeof p.old_string !== "string") return "Se necesita 'old_string'.";
    if (typeof p.new_string !== "string") return "Se necesita 'new_string'.";

    const filePath = normalizePath(p.file_path);

    if (!fs.existsSync(filePath)) {
        return `Archivo no encontrado: ${filePath}`;
    }

    const stat = fs.statSync(filePath);
    if (!stat.isFile()) return `'${filePath}' no es un archivo.`;
    if (stat.size > 10 * 1024 * 1024) return "Archivo demasiado grande (>10MB).";

    const original = fs.readFileSync(filePath, "utf-8");

    // Count occurrences
    const occurrences = countOccurrences(original, p.old_string);

    if (occurrences === 0) {
        // Help the user understand why — show similar lines
        const hint = findSimilarLines(original, p.old_string);
        return `No se encontró 'old_string' en ${path.basename(filePath)}.${hint ? `\nLíneas similares:\n${hint}` : ""}`;
    }

    if (occurrences > 1 && !p.replace_all) {
        return `'old_string' aparece ${occurrences} veces en ${path.basename(filePath)}. Usa replace_all=true para reemplazar todas, o haz old_string más específico (incluye más contexto).`;
    }

    // Apply replacement
    const updated = p.replace_all
        ? original.split(p.old_string).join(p.new_string)
        : original.replace(p.old_string, p.new_string);

    fs.writeFileSync(filePath, updated, "utf-8");

    // Generate a short diff summary
    const replacements = p.replace_all ? occurrences : 1;
    const addedLines = p.new_string.split("\n").length;
    const removedLines = p.old_string.split("\n").length;
    const delta = addedLines - removedLines;

    return `✓ ${path.basename(filePath)} editado: ${replacements} reemplazo${replacements > 1 ? "s" : ""} (${delta >= 0 ? "+" : ""}${delta} líneas)\n\`\`\`diff\n${generateMiniDiff(p.old_string, p.new_string)}\n\`\`\``;
}

function countOccurrences(text: string, search: string): number {
    let count = 0;
    let pos = 0;
    while ((pos = text.indexOf(search, pos)) !== -1) {
        count++;
        pos += search.length;
    }
    return count;
}

function findSimilarLines(content: string, search: string): string {
    const searchLines = search.trim().split("\n");
    if (searchLines.length === 0) return "";
    const firstLine = searchLines[0].trim();
    if (firstLine.length < 3) return "";

    const lines = content.split("\n");
    const similar: string[] = [];
    for (let i = 0; i < lines.length && similar.length < 3; i++) {
        if (lines[i].includes(firstLine.slice(0, Math.min(30, firstLine.length)))) {
            similar.push(`  L${i + 1}: ${lines[i].slice(0, 80)}`);
        }
    }
    return similar.join("\n");
}

function generateMiniDiff(old: string, neu: string): string {
    const oldLines = old.split("\n").slice(0, 8);
    const newLines = neu.split("\n").slice(0, 8);
    const parts: string[] = [];
    for (const l of oldLines) parts.push(`- ${l}`);
    for (const l of newLines) parts.push(`+ ${l}`);
    const moreOld = old.split("\n").length - oldLines.length;
    const moreNew = neu.split("\n").length - newLines.length;
    if (moreOld > 0) parts.push(`  ... (${moreOld} líneas más eliminadas)`);
    if (moreNew > 0) parts.push(`  ... (${moreNew} líneas más añadidas)`);
    return parts.join("\n");
}

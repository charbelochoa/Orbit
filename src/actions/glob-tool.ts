/**
 * glob_tool — Fast file pattern matching.
 * Uses native fs + recursive readdir (no external deps).
 */
import fs from "fs";
import path from "path";

export interface GlobParams {
    pattern: string;
    dir?:    string;
}

const MAX_RESULTS = 200;

// Common ignore patterns
const IGNORE_DIRS = new Set([
    "node_modules", ".git", ".hg", ".svn", "dist", "build",
    ".next", ".nuxt", "__pycache__", ".orbit", ".vscode",
    "coverage", ".cache", "vendor", "tmp", ".tmp",
]);

export async function globTool(parameters: any): Promise<string> {
    const p = parameters as GlobParams;
    if (!p?.pattern) return "Se necesita un 'pattern' (ej. '**/*.ts', 'src/**/*.json').";

    const baseDir = path.resolve(p.dir || process.cwd());
    if (!fs.existsSync(baseDir)) return `Directorio no encontrado: ${baseDir}`;

    const matches: string[] = [];
    const regex = globToRegex(p.pattern);

    await walkDir(baseDir, baseDir, regex, matches);

    const truncated = matches.length > MAX_RESULTS;
    const shown = truncated ? matches.slice(0, MAX_RESULTS) : matches;

    if (shown.length === 0) {
        return `No se encontraron archivos con el patrón '${p.pattern}' en ${baseDir}`;
    }

    const lines = shown.map(f => `  ${f}`).join("\n");
    return `Archivos encontrados: ${matches.length}${truncated ? ` (mostrando ${MAX_RESULTS})` : ""}\n${lines}`;
}

async function walkDir(root: string, dir: string, regex: RegExp, matches: string[]): Promise<void> {
    if (matches.length >= MAX_RESULTS + 50) return;

    let entries: fs.Dirent[];
    try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
        return;
    }

    for (const entry of entries) {
        if (entry.isDirectory()) {
            if (IGNORE_DIRS.has(entry.name)) continue;
            await walkDir(root, path.join(dir, entry.name), regex, matches);
        } else if (entry.isFile()) {
            const rel = path.relative(root, path.join(dir, entry.name)).replace(/\\/g, "/");
            if (regex.test(rel)) {
                matches.push(rel);
            }
        }
    }
}

/**
 * Convert a glob pattern to a regex.
 * Supports: * (any segment), ** (any path), ? (single char), {a,b} (alternation)
 */
function globToRegex(pattern: string): RegExp {
    let re = "";
    let i = 0;
    const pat = pattern.replace(/\\/g, "/");

    while (i < pat.length) {
        const ch = pat[i];
        if (ch === "*") {
            if (pat[i + 1] === "*") {
                // ** matches any path depth
                re += ".*";
                i += 2;
                if (pat[i] === "/") i++; // skip trailing /
            } else {
                // * matches anything except /
                re += "[^/]*";
                i++;
            }
        } else if (ch === "?") {
            re += "[^/]";
            i++;
        } else if (ch === "{") {
            const end = pat.indexOf("}", i);
            if (end !== -1) {
                const alts = pat.slice(i + 1, end).split(",").map(escapeRegex).join("|");
                re += `(?:${alts})`;
                i = end + 1;
            } else {
                re += escapeRegex(ch);
                i++;
            }
        } else if (ch === "[") {
            const end = pat.indexOf("]", i);
            if (end !== -1) {
                re += pat.slice(i, end + 1);
                i = end + 1;
            } else {
                re += escapeRegex(ch);
                i++;
            }
        } else {
            re += escapeRegex(ch);
            i++;
        }
    }

    return new RegExp(`^${re}$`, "i");
}

function escapeRegex(s: string): string {
    return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

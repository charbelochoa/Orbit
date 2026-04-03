/**
 * grep_tool — Local content search.
 * Uses ripgrep (rg) if available, fallback to pure JS.
 */
import { execSync, execFileSync } from "child_process";
import fs from "fs";
import path from "path";

export interface GrepParams {
    pattern:     string;
    dir?:        string;
    glob?:       string;
    ignore_case?: boolean;
    max_results?: number;
}

const DEFAULT_MAX = 100;

const IGNORE_DIRS = new Set([
    "node_modules", ".git", ".hg", "dist", "build",
    ".next", "__pycache__", "coverage", ".cache", "vendor",
]);

const BINARY_EXT = new Set([
    ".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico", ".svg",
    ".woff", ".woff2", ".ttf", ".eot", ".otf",
    ".zip", ".tar", ".gz", ".7z", ".rar",
    ".exe", ".dll", ".so", ".dylib", ".o",
    ".pdf", ".doc", ".docx", ".xls", ".xlsx",
    ".mp3", ".mp4", ".avi", ".mkv", ".wav",
    ".sqlite", ".db", ".lock",
]);

export async function grepTool(parameters: any): Promise<string> {
    const p = parameters as GrepParams;
    if (!p?.pattern) return "Se necesita un 'pattern' para buscar.";

    const dir = path.resolve(p.dir || process.cwd());
    if (!fs.existsSync(dir)) return `Directorio no encontrado: ${dir}`;

    // Security: restrict search to the project root
    const projectRoot = path.resolve(process.cwd());
    if (!dir.startsWith(projectRoot + path.sep) && dir !== projectRoot) {
        return `Búsqueda bloqueada: '${dir}' está fuera del directorio del proyecto.`;
    }

    const maxResults = Math.min(p.max_results || DEFAULT_MAX, 500);

    // Try ripgrep first
    const rgResult = tryRipgrep(p.pattern, dir, p.glob, p.ignore_case, maxResults);
    if (rgResult !== null) return rgResult;

    // Fallback to JS implementation
    return jsGrep(p.pattern, dir, p.glob, p.ignore_case !== false, maxResults);
}

function tryRipgrep(
    pattern: string, dir: string, glob?: string,
    ignoreCase?: boolean, max?: number,
): string | null {
    try {
        // Check if rg exists
        execSync("rg --version", { stdio: "ignore" });
    } catch {
        return null;
    }

    try {
        const rgArgs = ["--line-number", "--no-heading", "--color=never"];
        if (ignoreCase !== false) rgArgs.push("-i");
        if (max) rgArgs.push(`--max-count=${max}`);
        if (glob) rgArgs.push(`--glob=${glob}`);
        rgArgs.push("--", pattern, dir);

        const out = execFileSync("rg", rgArgs, {
            timeout: 15000,
            maxBuffer: 1024 * 1024,
            encoding: "utf-8",
            stdio: ["ignore", "pipe", "ignore"],
        });

        const lines = out.trim().split("\n").filter(Boolean);
        if (lines.length === 0) return `No se encontraron coincidencias para '${pattern}'`;

        // Make paths relative
        const formatted = lines.slice(0, max || DEFAULT_MAX).map(line => {
            const rel = line.startsWith(dir)
                ? line.slice(dir.length).replace(/^[/\\]/, "")
                : line;
            return `  ${rel}`;
        });

        return `Coincidencias: ${lines.length}${lines.length > (max || DEFAULT_MAX) ? "+" : ""}\n${formatted.join("\n")}`;
    } catch (e: any) {
        // rg exits with code 1 when no matches
        if (e.status === 1) return `No se encontraron coincidencias para '${pattern}'`;
        return null; // fallback to JS
    }
}

function jsGrep(
    pattern: string, dir: string, globFilter?: string,
    ignoreCase?: boolean, max?: number,
): string {
    const regex = new RegExp(pattern, ignoreCase ? "i" : "");
    const matches: string[] = [];
    const globRe = globFilter ? simpleGlobToRegex(globFilter) : null;

    walkGrep(dir, dir, regex, globRe, matches, max || DEFAULT_MAX);

    if (matches.length === 0) return `No se encontraron coincidencias para '${pattern}'`;
    return `Coincidencias: ${matches.length}\n${matches.join("\n")}`;
}

function walkGrep(
    root: string, dir: string, regex: RegExp, globRe: RegExp | null,
    matches: string[], max: number,
): void {
    if (matches.length >= max) return;

    let entries: fs.Dirent[];
    try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
        return;
    }

    for (const entry of entries) {
        if (matches.length >= max) break;

        const full = path.join(dir, entry.name);

        if (entry.isDirectory()) {
            if (IGNORE_DIRS.has(entry.name)) continue;
            walkGrep(root, full, regex, globRe, matches, max);
        } else if (entry.isFile()) {
            const ext = path.extname(entry.name).toLowerCase();
            if (BINARY_EXT.has(ext)) continue;

            const rel = path.relative(root, full).replace(/\\/g, "/");
            if (globRe && !globRe.test(rel)) continue;

            try {
                const stat = fs.statSync(full);
                if (stat.size > 512 * 1024) continue; // Skip files > 512KB

                const content = fs.readFileSync(full, "utf-8");
                const lines = content.split("\n");
                for (let i = 0; i < lines.length && matches.length < max; i++) {
                    if (regex.test(lines[i])) {
                        matches.push(`  ${rel}:${i + 1}: ${lines[i].slice(0, 120)}`);
                    }
                }
            } catch {
                // skip unreadable files
            }
        }
    }
}

function simpleGlobToRegex(glob: string): RegExp {
    const re = glob
        .replace(/\./g, "\\.")
        .replace(/\*\*/g, "§§")
        .replace(/\*/g, "[^/]*")
        .replace(/§§/g, ".*")
        .replace(/\?/g, "[^/]");
    return new RegExp(re, "i");
}

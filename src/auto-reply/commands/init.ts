/**
 * /init — Analiza el proyecto actual y genera ORBIT.md
 *
 * Similar a Claude Code's /init que genera CLAUDE.md.
 * Lee la estructura del directorio, identifica package.json, tsconfig, README, etc.
 * y produce un archivo ORBIT.md con el contexto del proyecto.
 */

import fs from "fs";
import path from "path";
import type { CommandHandler } from "../types.js";

// Files to read for context (capped per file to avoid giant blobs)
const CONTEXT_FILES = [
    "package.json",
    "tsconfig.json",
    "README.md",
    ".env.example",
    "Cargo.toml",
    "pyproject.toml",
    "requirements.txt",
    "go.mod",
    "Makefile",
    "Dockerfile",
    "docker-compose.yml",
    "docker-compose.yaml",
];

const IGNORED_DIRS = new Set([
    "node_modules", ".git", "dist", "build", ".next", ".nuxt",
    "__pycache__", ".venv", "venv", "target", "vendor", ".turbo",
    "coverage", ".cache", ".parcel-cache", "out",
]);

const MAX_DEPTH = 4;
const MAX_FILE_READ = 2048; // chars

function buildTree(dir: string, depth = 0, prefix = ""): string[] {
    if (depth > MAX_DEPTH) return [`${prefix}...`];
    let entries: fs.Dirent[];
    try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
        return [];
    }

    // Sort: dirs first, then files
    entries.sort((a, b) => {
        if (a.isDirectory() && !b.isDirectory()) return -1;
        if (!a.isDirectory() && b.isDirectory()) return 1;
        return a.name.localeCompare(b.name);
    });

    // Filter ignored
    entries = entries.filter(e => {
        if (e.name.startsWith(".") && e.isDirectory()) return false;
        if (IGNORED_DIRS.has(e.name)) return false;
        return true;
    });

    // Cap entries at 30 per level to avoid huge trees
    const capped = entries.length > 30;
    if (capped) entries = entries.slice(0, 30);

    const lines: string[] = [];
    for (let i = 0; i < entries.length; i++) {
        const entry = entries[i];
        const isLast = i === entries.length - 1 && !capped;
        const connector = isLast ? "└── " : "├── ";
        const childPrefix = isLast ? "    " : "│   ";

        if (entry.isDirectory()) {
            lines.push(`${prefix}${connector}${entry.name}/`);
            lines.push(...buildTree(path.join(dir, entry.name), depth + 1, prefix + childPrefix));
        } else {
            lines.push(`${prefix}${connector}${entry.name}`);
        }
    }
    if (capped) lines.push(`${prefix}└── ... (+${entries.length - 30} más)`);
    return lines;
}

function readSnippet(filePath: string): string | null {
    try {
        if (!fs.existsSync(filePath)) return null;
        const stat = fs.statSync(filePath);
        if (stat.size > 100_000) return null; // skip very large files
        const content = fs.readFileSync(filePath, "utf-8");
        return content.length > MAX_FILE_READ
            ? content.slice(0, MAX_FILE_READ) + "\n... (truncado)"
            : content;
    } catch {
        return null;
    }
}

function detectStack(cwd: string): string[] {
    const stack: string[] = [];
    const has = (f: string) => fs.existsSync(path.join(cwd, f));

    if (has("package.json")) {
        stack.push("Node.js");
        const pkg = readSnippet(path.join(cwd, "package.json"));
        if (pkg) {
            if (pkg.includes("\"react\"")) stack.push("React");
            if (pkg.includes("\"next\"")) stack.push("Next.js");
            if (pkg.includes("\"vue\"")) stack.push("Vue");
            if (pkg.includes("\"svelte\"")) stack.push("Svelte");
            if (pkg.includes("\"express\"")) stack.push("Express");
            if (pkg.includes("\"fastify\"")) stack.push("Fastify");
            if (pkg.includes("\"electron\"")) stack.push("Electron");
            if (pkg.includes("\"typescript\"")) stack.push("TypeScript");
            if (pkg.includes("\"vite\"")) stack.push("Vite");
            if (pkg.includes("\"webpack\"")) stack.push("Webpack");
            if (pkg.includes("\"jest\"")) stack.push("Jest");
            if (pkg.includes("\"vitest\"")) stack.push("Vitest");
            if (pkg.includes("\"prisma\"")) stack.push("Prisma");
            if (pkg.includes("\"tailwindcss\"")) stack.push("Tailwind CSS");
        }
    }
    if (has("Cargo.toml")) stack.push("Rust");
    if (has("go.mod")) stack.push("Go");
    if (has("pyproject.toml") || has("requirements.txt") || has("setup.py")) stack.push("Python");
    if (has("Gemfile")) stack.push("Ruby");
    if (has("pom.xml") || has("build.gradle")) stack.push("Java");
    if (has("Dockerfile") || has("docker-compose.yml")) stack.push("Docker");
    if (has(".github/workflows")) stack.push("GitHub Actions");
    if (has("Makefile")) stack.push("Make");

    return stack;
}

function detectScripts(cwd: string): Record<string, string> {
    try {
        const pkg = JSON.parse(fs.readFileSync(path.join(cwd, "package.json"), "utf-8"));
        return pkg.scripts || {};
    } catch {
        return {};
    }
}

export const initCommand: CommandHandler = async (ctx) => {
    const cwd = process.cwd();
    const projectName = path.basename(cwd);
    const orbitMdPath = path.join(cwd, "ORBIT.md");

    // Check if ORBIT.md already exists
    if (fs.existsSync(orbitMdPath) && ctx.subcommand !== "force") {
        const existing = readSnippet(orbitMdPath);
        ctx.sendReply({
            type: "command_result",
            command: "init",
            message: `⚠️ Ya existe un **ORBIT.md** en este proyecto.\nUsa \`/init force\` para regenerarlo.\n\n---\n${existing ?? "(no se pudo leer)"}`,
        });
        return;
    }

    ctx.sendReply({
        type: "orbit_chunk",
        text: "Analizando proyecto...\n",
    });

    // 1. Build directory tree
    const tree = buildTree(cwd);

    // 2. Detect tech stack
    const stack = detectStack(cwd);

    // 3. Read key files
    const contextSnippets: string[] = [];
    for (const file of CONTEXT_FILES) {
        const content = readSnippet(path.join(cwd, file));
        if (content) {
            contextSnippets.push(`### ${file}\n\`\`\`\n${content}\n\`\`\``);
        }
    }

    // 4. Detect scripts
    const scripts = detectScripts(cwd);
    const scriptLines = Object.entries(scripts).map(([k, v]) => `- \`npm run ${k}\` → \`${v}\``);

    // 5. Build ORBIT.md
    const date = new Date().toLocaleDateString("es-MX", {
        weekday: "long", year: "numeric", month: "long", day: "numeric",
    });

    const sections: string[] = [
        `# ORBIT.md — ${projectName}`,
        ``,
        `> Generado por Orbit AI el ${date}.`,
        `> Este archivo da contexto a Orbit sobre tu proyecto. Edítalo libremente.`,
        ``,
        `## Resumen`,
        ``,
        `- **Proyecto:** ${projectName}`,
        `- **Ruta:** \`${cwd}\``,
        `- **Stack:** ${stack.length ? stack.join(", ") : "No detectado"}`,
        ``,
    ];

    // Scripts section
    if (scriptLines.length) {
        sections.push(
            `## Scripts disponibles`,
            ``,
            ...scriptLines,
            ``,
        );
    }

    // Project conventions — user should fill these
    sections.push(
        `## Convenciones del proyecto`,
        ``,
        `<!-- Orbit lee estas convenciones antes de generar código. Edita según tu estilo: -->`,
        ``,
        `- **Estilo:** (ej. "Usa arrow functions, no clases")`,
        `- **Imports:** (ej. "Siempre usa .js extension")`,
        `- **Tests:** (ej. "Vitest, archivos *.test.ts junto al source")`,
        `- **Commit:** (ej. "Conventional commits en español")`,
        `- **Idioma:** (ej. "Código en inglés, comentarios en español")`,
        ``,
    );

    // Directory structure
    sections.push(
        `## Estructura`,
        ``,
        `\`\`\``,
        `${projectName}/`,
        ...tree,
        `\`\`\``,
        ``,
    );

    // Key files
    if (contextSnippets.length) {
        sections.push(
            `## Archivos clave`,
            ``,
            ...contextSnippets,
            ``,
        );
    }

    // Notes section
    sections.push(
        `## Notas para Orbit`,
        ``,
        `<!-- Agrega aquí cualquier instrucción específica que Orbit deba seguir: -->`,
        `<!-- Ejemplo: "No modifiques los archivos en /legacy" -->`,
        `<!-- Ejemplo: "El API principal está en src/api/routes.ts" -->`,
        ``,
    );

    const orbitMd = sections.join("\n");

    // Write file
    fs.writeFileSync(orbitMdPath, orbitMd, "utf-8");

    // Return summary
    const summary = [
        `✅ **ORBIT.md** generado para **${projectName}**`,
        ``,
        `📁 Estructura: ${tree.length} entradas mapeadas`,
        `🔧 Stack: ${stack.length ? stack.join(", ") : "—"}`,
        `📜 Scripts: ${scriptLines.length || 0} detectados`,
        `📄 Archivos clave: ${contextSnippets.length} leídos`,
        ``,
        `Edita la sección **"Convenciones del proyecto"** y **"Notas para Orbit"** para personalizar cómo Orbit trabaja con tu código.`,
    ].join("\n");

    return summary;
};

import fs from "node:fs/promises";
import path from "node:path";
import { isWithin, workspaceRoot } from "../core/workspace.js";

const PROJECT_MARKERS = [
    "pyproject.toml", "setup.py", "setup.cfg", "requirements.txt", "package.json", "tsconfig.json", "deno.json",
    "Cargo.toml", "go.mod", "pom.xml", "build.gradle", "build.gradle.kts", "Gemfile", "composer.json", "mix.exs",
    "pubspec.yaml", "CMakeLists.txt", "Makefile", "Dockerfile", "AGENTS.md", "CLAUDE.md", ".cursorrules", "ORBIT.md",
];
const CONTEXT_FILES = ["ORBIT.md", "AGENTS.md", "CLAUDE.md", ".cursorrules"];
const PYTHON_LOCKFILES = [["uv.lock", "uv"], ["poetry.lock", "poetry"], ["Pipfile.lock", "pipenv"]];
const JS_LOCKFILES = [
    ["pnpm-lock.yaml", "pnpm"], ["bun.lockb", "bun"], ["bun.lock", "bun"], ["yarn.lock", "yarn"], ["package-lock.json", "npm"],
];
const VERIFY_TARGETS = ["test", "tests", "lint", "typecheck", "check", "build", "fmt", "format"];
const MAX_FACT_BYTES = 256 * 1024;
const MAX_RULE_CHARACTERS = 12_000;

interface ProjectDirectory {
    directory: string;
    entries: Set<string>;
}

interface ProjectFacts {
    cwd: string;
    root: string;
    manifests: string[];
    packageManagers: string[];
    verifyCommands: string[];
    rules: Array<{ file: string; instructions: string }>;
}

async function discoverWorkspace(cwd: string): Promise<ProjectDirectory[]> {
    const chain: ProjectDirectory[] = [];
    let directory = cwd;
    let marker = -1;
    for (let depth = 0; depth < 24; depth++) {
        try {
            const entries = new Set(await fs.readdir(directory));
            chain.push({ directory, entries });
            if (entries.has(".git") || entries.has(".hg")) return chain;
            if (marker === -1 && PROJECT_MARKERS.some(file => entries.has(file))) marker = chain.length;
        } catch {
            break;
        }
        const parent = path.dirname(directory);
        if (parent === directory) break;
        directory = parent;
    }
    return marker === -1 ? [] : chain.slice(0, marker);
}

async function readSmall(root: string, filename: string): Promise<string> {
    try {
        const resolved = await fs.realpath(filename);
        if (!isWithin(root, resolved)) return "";
        const source = await fs.open(resolved, "r");
        try {
            const stat = await source.stat();
            if (!stat.isFile() || stat.size > MAX_FACT_BYTES) return "";
            const buffer = Buffer.alloc(stat.size);
            const { bytesRead } = await source.read(buffer, 0, buffer.length, 0);
            return buffer.subarray(0, bytesRead).toString("utf-8").replace(/^\uFEFF/, "");
        } finally {
            await source.close();
        }
    } catch {
        return "";
    }
}

async function detectProjectFacts(cwd: string): Promise<ProjectFacts | undefined> {
    const chain = await discoverWorkspace(cwd);
    const project = chain.at(-1);
    if (!project) return undefined;
    const root = project.directory;
    const entries = project.entries;
    const read = (name: string) => readSmall(root, path.join(root, name));
    const [manifest, makefile, pyproject] = await Promise.all([read("package.json"), read("Makefile"), read("pyproject.toml")]);

    const verifyCommands: string[] = [];
    if (await read("scripts/run_tests.sh")) verifyCommands.push("scripts/run_tests.sh");
    if (manifest) {
        try {
            const pkg = JSON.parse(manifest);
            const scripts = pkg.scripts;
            const manager = JS_LOCKFILES.find(([lock]) => entries.has(lock))?.[1] ?? "npm";
            if (scripts && typeof scripts === "object") {
                verifyCommands.push(...VERIFY_TARGETS.filter(name => typeof scripts[name] === "string").map(name => `${manager} run ${name}`));
            }
        } catch {}
    }
    if (entries.has("pytest.ini") || pyproject.includes("[tool.pytest")) verifyCommands.push("pytest");
    verifyCommands.push(...VERIFY_TARGETS.filter(name => new RegExp(`^${name}\\s*:`, "m").test(makefile)).map(name => `make ${name}`));

    const rules: ProjectFacts["rules"] = [];
    let remaining = MAX_RULE_CHARACTERS;
    for (const item of chain.reverse()) {
        for (const name of CONTEXT_FILES) {
            if (!item.entries.has(name) || remaining <= 0) continue;
            const filename = path.join(item.directory, name);
            const instructions = (await readSmall(root, filename)).trim();
            if (!instructions) continue;
            const limit = Math.min(remaining, 4000);
            rules.push({ file: path.relative(root, filename), instructions: instructions.slice(0, limit) });
            remaining -= Math.min(instructions.length, limit);
            if (name !== "ORBIT.md") break;
        }
    }

    return {
        cwd,
        root,
        manifests: PROJECT_MARKERS.filter(name => entries.has(name) && !CONTEXT_FILES.includes(name)),
        packageManagers: [...new Set([...PYTHON_LOCKFILES, ...JS_LOCKFILES].filter(([lock]) => entries.has(lock)).map(([, manager]) => manager))],
        verifyCommands: [...new Set(verifyCommands)].slice(0, 8),
        rules,
    };
}

export async function buildProjectContext(): Promise<string> {
    const requested = workspaceRoot();
    const cwd = await fs.realpath(requested).catch(() => requested);
    const facts = await detectProjectFacts(cwd);
    return JSON.stringify(facts ?? { cwd });
}

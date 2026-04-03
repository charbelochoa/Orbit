/**
 * Orbit Skill Store — Sprint 6
 *
 * Provides a local/remote skill marketplace for Orbit:
 *   - searchSkills(query)      → search by name/tag/description
 *   - installSkill(source)     → download & install from URL or local path
 *   - uninstallSkill(name)     → remove from skills/ directory
 *   - listStoreSkills()        → all skills in the catalog
 *   - refreshCatalog()         → re-fetch remote index
 *
 * Catalog format (local JSON / remote):
 * {
 *   "version": 1,
 *   "skills": [
 *     {
 *       "name": "docker-deploy",
 *       "description": "Deploy Docker containers via CLI",
 *       "tags": ["docker","devops"],
 *       "author": "orbit-official",
 *       "url": "https://raw.githubusercontent.com/.../docker-deploy/SKILL.md",
 *       "version": "1.0.0"
 *     }
 *   ]
 * }
 *
 * Local catalog: data/skill-store.json
 * Remote catalog URL: configurable (skill_store.catalogUrl in orbit.yaml)
 *   default: https://raw.githubusercontent.com/orbit-ai/skills/main/catalog.json
 */

import fs    from "fs/promises";
import path  from "path";
import https from "https";
import http  from "http";
import { fileURLToPath } from "url";
import { createLogger }  from "../infra/logger.js";
import { skillRegistry } from "./registry.js";

const log = createLogger("skill-store");
const __dirname     = path.dirname(fileURLToPath(import.meta.url));
const CATALOG_PATH  = path.join(__dirname, "../../data/skill-store.json");
const SKILLS_DIR    = path.join(__dirname, "../../skills");

// ── Types ────────────────────────────────────────────────────────────────────

export interface CatalogEntry {
    name:        string;
    description: string;
    tags:        string[];
    author:      string;
    /** Direct URL to SKILL.md (raw text) */
    url:         string;
    version:     string;
}

export interface SkillCatalog {
    version:  number;
    skills:   CatalogEntry[];
    fetchedAt?: number;
}

export interface InstallResult {
    success:  boolean;
    name:     string;
    path?:    string;
    error?:   string;
}

// ── HTTP helper ──────────────────────────────────────────────────────────────

function fetchText(url: string, timeoutMs = 10_000): Promise<string> {
    return new Promise((resolve, reject) => {
        const lib = url.startsWith("https://") ? https : http;
        const req = lib.get(url, { timeout: timeoutMs }, (res) => {
            if (res.statusCode === 301 || res.statusCode === 302) {
                const loc = res.headers.location;
                if (loc) return fetchText(loc, timeoutMs).then(resolve).catch(reject);
                return reject(new Error(`Redirect sin Location header`));
            }
            if ((res.statusCode ?? 0) >= 300) {
                return reject(new Error(`HTTP ${res.statusCode} al obtener ${url}`));
            }
            const chunks: Buffer[] = [];
            res.on("data", (c: Buffer) => chunks.push(c));
            res.on("end",  () => resolve(Buffer.concat(chunks).toString("utf-8")));
            res.on("error", reject);
        });
        req.on("error",   reject);
        req.on("timeout", () => { req.destroy(); reject(new Error(`Timeout al obtener ${url}`)); });
    });
}

// ── Catalog I/O ──────────────────────────────────────────────────────────────

async function loadCatalog(): Promise<SkillCatalog> {
    try {
        const raw = await fs.readFile(CATALOG_PATH, "utf-8");
        return JSON.parse(raw) as SkillCatalog;
    } catch {
        return { version: 1, skills: [] };
    }
}

async function saveCatalog(catalog: SkillCatalog): Promise<void> {
    await fs.mkdir(path.dirname(CATALOG_PATH), { recursive: true });
    await fs.writeFile(CATALOG_PATH, JSON.stringify(catalog, null, 2), "utf-8");
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Re-fetch the remote skill catalog and merge with any locally-added entries.
 * Falls back to the local cached catalog if offline.
 */
export async function refreshCatalog(catalogUrl?: string): Promise<SkillCatalog> {
    const url = catalogUrl
        ?? "https://raw.githubusercontent.com/orbit-ai/skills/main/catalog.json";

    let remote: SkillCatalog | null = null;
    try {
        const text = await fetchText(url);
        remote = JSON.parse(text) as SkillCatalog;
        log.info(`Catálogo remoto obtenido: ${remote.skills.length} skills`);
    } catch (err: any) {
        log.warn(`No se pudo obtener catálogo remoto (${err.message}) — usando caché local`);
    }

    const local = await loadCatalog();

    if (remote) {
        // Merge: remote takes priority for shared names
        const merged = new Map<string, CatalogEntry>();
        for (const s of local.skills)  merged.set(s.name, s);
        for (const s of remote.skills) merged.set(s.name, s);
        const catalog: SkillCatalog = {
            version:  remote.version,
            skills:   Array.from(merged.values()),
            fetchedAt: Date.now(),
        };
        await saveCatalog(catalog);
        return catalog;
    }

    return local;
}

/**
 * List all skills in the local catalog.
 */
export async function listStoreSkills(): Promise<CatalogEntry[]> {
    const catalog = await loadCatalog();
    return catalog.skills;
}

/**
 * Search skills by name, tag, or description keyword.
 */
export async function searchSkills(query: string): Promise<CatalogEntry[]> {
    const catalog = await loadCatalog();
    const q = query.toLowerCase();
    return catalog.skills.filter(s =>
        s.name.toLowerCase().includes(q) ||
        s.description.toLowerCase().includes(q) ||
        s.tags.some(t => t.toLowerCase().includes(q)) ||
        s.author.toLowerCase().includes(q),
    );
}

/**
 * Install a skill from:
 *  - A URL pointing to a raw SKILL.md
 *  - A catalog entry name (looks up URL from local catalog)
 *  - A local file path
 *
 * The skill is placed in skills/<sanitizedName>/SKILL.md
 */
export async function installSkill(source: string): Promise<InstallResult> {
    let content = "";
    let skillName = "";

    // ── Determine source type ────────────────────────────────────────────────
    if (source.startsWith("http://") || source.startsWith("https://")) {
        // Direct URL
        try {
            content   = await fetchText(source);
            skillName = _nameFromUrl(source);
        } catch (err: any) {
            return { success: false, name: source, error: err.message };
        }
    } else if (source.includes("/") || source.includes("\\") || source.endsWith(".md")) {
        // Local path
        try {
            content   = await fs.readFile(source, "utf-8");
            skillName = path.basename(path.dirname(source)) || path.basename(source, ".md");
        } catch (err: any) {
            return { success: false, name: source, error: err.message };
        }
    } else {
        // Catalog name lookup
        const catalog = await loadCatalog();
        const entry   = catalog.skills.find(s => s.name.toLowerCase() === source.toLowerCase());
        if (!entry) {
            // Auto-refresh and retry once
            const refreshed = await refreshCatalog().catch(() => catalog);
            const retryEntry = refreshed.skills.find(s => s.name.toLowerCase() === source.toLowerCase());
            if (!retryEntry) {
                return {
                    success: false,
                    name:    source,
                    error:   `Skill '${source}' no encontrada en el catálogo. Prueba /skill search ${source}`,
                };
            }
            try {
                content   = await fetchText(retryEntry.url);
                skillName = retryEntry.name;
            } catch (err: any) {
                return { success: false, name: source, error: err.message };
            }
        } else {
            try {
                content   = await fetchText(entry.url);
                skillName = entry.name;
            } catch (err: any) {
                return { success: false, name: source, error: err.message };
            }
        }
    }

    // ── Extract name from frontmatter if available ───────────────────────────
    const fmMatch = content.match(/^---[\s\S]*?name:\s*["']?(.+?)["']?\s*\n/m);
    if (fmMatch) skillName = fmMatch[1].trim();

    // Sanitize folder name
    const folderName = skillName.replace(/[^a-zA-Z0-9-_]/g, "-").toLowerCase();
    const skillDir   = path.join(SKILLS_DIR, folderName);
    const skillPath  = path.join(skillDir, "SKILL.md");

    // ── Check if already installed ───────────────────────────────────────────
    try {
        await fs.access(skillPath);
        log.info(`Skill '${skillName}' ya instalada en ${skillPath} — sobreescribiendo`);
    } catch { /* not installed yet, proceed */ }

    await fs.mkdir(skillDir, { recursive: true });
    await fs.writeFile(skillPath, content, "utf-8");

    log.info(`✅ Skill '${skillName}' instalada en ${skillPath}`);

    // ── Reload skill registry ────────────────────────────────────────────────
    try {
        const { loadAllSkills } = await import("./loader.js");
        await loadAllSkills(SKILLS_DIR);
        log.info("Skill registry recargado");
    } catch (err: any) {
        log.warn("No se pudo recargar el skill registry:", err.message);
    }

    return { success: true, name: skillName, path: skillPath };
}

/**
 * Uninstall a skill by name (removes its directory under skills/).
 */
export async function uninstallSkill(name: string): Promise<InstallResult> {
    const folderName = name.replace(/[^a-zA-Z0-9-_]/g, "-").toLowerCase();

    // Check in loaded skills first
    const loaded = skillRegistry.get(name);
    let skillDir: string | null = null;

    if (loaded) {
        // Derive directory from the skill's path stored in source
        skillDir = path.join(SKILLS_DIR, folderName);
    } else {
        // Try to find by folder name
        skillDir = path.join(SKILLS_DIR, folderName);
        try {
            await fs.access(path.join(skillDir, "SKILL.md"));
        } catch {
            return { success: false, name, error: `Skill '${name}' no está instalada.` };
        }
    }

    try {
        await fs.rm(skillDir, { recursive: true, force: true });
        log.info(`🗑️ Skill '${name}' desinstalada (${skillDir})`);

        // Reload registry
        try {
            const { loadAllSkills } = await import("./loader.js");
            await loadAllSkills(SKILLS_DIR);
        } catch { /* non-fatal */ }

        return { success: true, name, path: skillDir };
    } catch (err: any) {
        return { success: false, name, error: err.message };
    }
}

/**
 * Add a skill entry directly to the local catalog (for self-published skills).
 */
export async function publishToCatalog(entry: CatalogEntry): Promise<void> {
    const catalog = await loadCatalog();
    const idx = catalog.skills.findIndex(s => s.name === entry.name);
    if (idx >= 0) {
        catalog.skills[idx] = entry;
    } else {
        catalog.skills.push(entry);
    }
    await saveCatalog(catalog);
    log.info(`Skill '${entry.name}' publicada en catálogo local`);
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function _nameFromUrl(url: string): string {
    const parts = url.split("/").filter(Boolean);
    // Try to extract from path: .../skills/<name>/SKILL.md
    const idx = parts.findIndex(p => p.toUpperCase() === "SKILL.MD");
    if (idx > 0) return parts[idx - 1];
    // Fallback: last meaningful path segment
    return parts.at(-1)?.replace(/\.md$/i, "") ?? "unknown-skill";
}

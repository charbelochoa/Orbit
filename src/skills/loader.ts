/**
 * Orbit Skills Loader — Phase 5
 * Scans the skills/ directory and loads every SKILL.md into the registry.
 * Parses YAML frontmatter using the `yaml` package.
 */

import fs          from "fs/promises";
import path        from "path";
import { fileURLToPath } from "url";
import yaml        from "yaml";
import { skillRegistry } from "./registry.js";
import type { Skill }    from "./types.js";
import { createLogger }  from "../infra/logger.js";

const log = createLogger("SkillLoader");
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── Frontmatter parser ────────────────────────────────────────────────────────

const FM_RE = /^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/s;

function parseFrontmatter(raw: string): { fm: Record<string, any>; body: string } {
    const match = raw.match(FM_RE);
    if (!match) return { fm: {}, body: raw };
    try {
        return { fm: yaml.parse(match[1]) || {}, body: match[2] };
    } catch {
        return { fm: {}, body: raw };
    }
}

// ── Public API ────────────────────────────────────────────────────────────────

export async function loadAllSkills(skillsDir?: string): Promise<void> {
    const dir = skillsDir ?? path.join(__dirname, "../../skills");
    let loaded = 0;
    try {
        const entries = await fs.readdir(dir, { withFileTypes: true });
        for (const entry of entries) {
            if (!entry.isDirectory()) continue;
            const skillPath = path.join(dir, entry.name, "SKILL.md");
            try {
                const raw  = await fs.readFile(skillPath, "utf-8");
                const { fm, body } = parseFrontmatter(raw);
                const orbitMeta = fm?.metadata?.orbit ?? {};

                const skill: Skill = {
                    metadata: {
                        name:        fm.name        ?? entry.name,
                        description: fm.description ?? "",
                        emoji:       orbitMeta.emoji    ?? "🔧",
                        category:    orbitMeta.category ?? "general",
                        tools:       Array.isArray(orbitMeta.tools) ? orbitMeta.tools : [],
                        path:        skillPath,
                    },
                    content: body.trim(),
                };
                skillRegistry.register(skill);
                loaded++;
                log.debug(`Skill cargado: ${skill.metadata.name}`);
            } catch (e: any) {
                log.warn(`Skill '${entry.name}' no se pudo cargar: ${e.message}`);
            }
        }
    } catch {
        log.warn(`Directorio de skills no encontrado: ${dir} — continuando sin skills`);
    }
    log.info(`${loaded} skill(s) cargados.`);
}

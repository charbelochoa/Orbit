/**
 * /skills list | /skills help <name>
 * /skill install <url|name> | /skill search <query> | /skill remove <name>
 * /skill store [refresh] | /skill publish <name> <url>
 */

import { skillRegistry }       from "../../skills/registry.js";
import {
    searchSkills,
    installSkill,
    uninstallSkill,
    listStoreSkills,
    refreshCatalog,
    publishToCatalog,
}                              from "../../skills/store.js";
import type { CommandHandler } from "../types.js";

export const skillsCommand: CommandHandler = async (ctx) => {
    const sub  = ctx.subcommand;
    const name = ctx.argStr.trim();

    // ── list (default) ────────────────────────────────────────────────────────
    if (!sub || sub === "list") {
        const skills = skillRegistry.getAll();
        if (skills.length === 0) {
            return "No hay skills cargados. Comprueba que la carpeta skills/ existe en la raíz del proyecto.";
        }
        const lines = skills.map(s =>
            `${s.metadata.emoji} **${s.metadata.name}** (${s.metadata.category})\n  ${s.metadata.description.slice(0, 90)}`
        );
        return `**Skills disponibles (${skills.length}):**\n${lines.join("\n")}`;
    }

    // ── help ─────────────────────────────────────────────────────────────────
    if (sub === "help") {
        if (!name) return "Uso: /skills help <nombre>";
        const skill = skillRegistry.get(name);
        if (!skill) {
            const available = skillRegistry.getAll().map(s => s.metadata.name).join(", ");
            return `Skill "${name}" no encontrado.\nDisponibles: ${available}`;
        }
        ctx.sendReply({ type: "skill_content", name: skill.metadata.name, content: skill.content });
        return `**${skill.metadata.emoji} ${skill.metadata.name}**\n\n${skill.content.slice(0, 1200)}`;
    }

    // ── search store ─────────────────────────────────────────────────────────
    if (sub === "search") {
        if (!name) return "Uso: /skill search <query>";
        const hits = await searchSkills(name);
        if (hits.length === 0) {
            return `No se encontraron skills para "${name}" en el catálogo. Prueba /skill store refresh para actualizar.`;
        }
        const lines = hits.map(s =>
            `📦 **${s.name}** v${s.version} — ${s.description}\n  Tags: ${s.tags.join(", ")} | Autor: ${s.author}`
        );
        return `**Resultados para "${name}" (${hits.length}):**\n${lines.join("\n")}`;
    }

    // ── install ───────────────────────────────────────────────────────────────
    if (sub === "install") {
        if (!name) return "Uso: /skill install <nombre|url>";
        ctx.sendReply({ type: "status", text: `Instalando skill "${name}"...` });
        const result = await installSkill(name);
        if (!result.success) return `❌ Error instalando "${name}": ${result.error}`;
        return `✅ Skill **${result.name}** instalada en ${result.path}\nReinicia o ejecuta /skills list para verla activa.`;
    }

    // ── remove / uninstall ────────────────────────────────────────────────────
    if (sub === "remove" || sub === "uninstall") {
        if (!name) return `Uso: /skill ${sub} <nombre>`;
        const result = await uninstallSkill(name);
        if (!result.success) return `❌ Error eliminando "${name}": ${result.error}`;
        return `🗑️ Skill **${result.name}** eliminada.`;
    }

    // ── store (catalog management) ────────────────────────────────────────────
    if (sub === "store") {
        const action = name.toLowerCase();
        if (action === "refresh") {
            ctx.sendReply({ type: "status", text: "Actualizando catálogo remoto..." });
            const catalog = await refreshCatalog();
            return `✅ Catálogo actualizado: ${catalog.skills.length} skills disponibles.`;
        }
        // Default: list store
        const storeSkills = await listStoreSkills();
        if (storeSkills.length === 0) {
            return "El catálogo está vacío. Usa /skill store refresh para descargar el índice remoto.";
        }
        const lines = storeSkills.map(s =>
            `📦 **${s.name}** v${s.version} — ${s.description}`
        );
        return `**Catálogo de Skills (${storeSkills.length}):**\n${lines.join("\n")}\n\nInstala con: /skill install <nombre>`;
    }

    // ── publish ───────────────────────────────────────────────────────────────
    if (sub === "publish") {
        // /skill publish <name> <url>
        const parts = name.split(/\s+/);
        if (parts.length < 2) return "Uso: /skill publish <nombre> <url_del_SKILL.md>";
        const [pName, pUrl] = parts;
        if (!pUrl.startsWith("http")) return "La URL debe comenzar con http:// o https://";
        await publishToCatalog({
            name:        pName,
            description: `Skill publicada localmente: ${pName}`,
            tags:        [],
            author:      "local",
            url:         pUrl,
            version:     "1.0.0",
        });
        return `✅ Skill **${pName}** añadida al catálogo local con URL: ${pUrl}`;
    }

    return "Subcomandos: list | help <nombre> | search <query> | install <nombre|url> | remove <nombre> | store [refresh] | publish <nombre> <url>";
};


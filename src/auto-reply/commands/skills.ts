/**
 * /skills list | /skills help <name>
 * Lists available skills and shows their content.
 */

import { skillRegistry }       from "../../skills/registry.js";
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

    return "Subcomandos: list | help <nombre>";
};

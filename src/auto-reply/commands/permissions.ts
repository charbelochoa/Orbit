/**
 * /permissions — Sprint 8: gestión interactiva de permisos por herramienta.
 *
 * Subcomandos:
 *   /permissions show                  — muestra reglas locales en .orbit/settings.local.json
 *   /permissions allow  <tool>         — permite siempre
 *   /permissions deny   <tool>         — deniega siempre
 *   /permissions ask    <tool>         — pide confirmación cada vez
 *   /permissions clear  <tool>         — elimina regla local (vuelve a la predeterminada)
 *   /permissions pending               — lista peticiones de permiso en espera
 */

import fs   from "fs";
import path from "path";

import { policyEngine, type PolicyAction } from "../../core/tool-policy.js";
import { getPendingRequests, cancelAllPending } from "../../core/permission-broker.js";
import type { CommandContext } from "../types.js";

export async function permissionsCommand(ctx: CommandContext): Promise<string> {
    const [sub, toolId] = ctx.args;

    switch (sub) {
        /* ── show ─────────────────────────────────────────────────────── */
        case "show":
        case undefined: {
            const filePath = path.join(process.cwd(), ".orbit", "settings.local.json");
            if (!fs.existsSync(filePath)) {
                return "No hay reglas locales. Archivo `.orbit/settings.local.json` no existe.";
            }
            let settings: { allow?: string[]; deny?: string[]; ask?: string[] } = {};
            try { settings = JSON.parse(fs.readFileSync(filePath, "utf-8")); } catch {
                return "Error al leer `.orbit/settings.local.json`.";
            }
            const rows: string[] = [];
            for (const id of settings.allow || []) rows.push(`  ✅ **${id}** → allow`);
            for (const id of settings.deny  || []) rows.push(`  ❌ **${id}** → deny`);
            for (const id of settings.ask   || []) rows.push(`  ❓ **${id}** → ask`);
            if (rows.length === 0) return "No hay reglas locales activas.";
            return `**Reglas locales de permisos:**\n${rows.join("\n")}`;
        }

        /* ── allow / deny / ask ───────────────────────────────────────── */
        case "allow":
        case "deny":
        case "ask": {
            if (!toolId) return `Uso: /permissions ${sub} <nombre_herramienta>`;
            const action = sub as PolicyAction;
            policyEngine.saveLocalRule(toolId, action);
            const emoji = action === "allow" ? "✅" : action === "deny" ? "❌" : "❓";
            return `${emoji} Regla guardada: **${toolId}** → **${action}**`;
        }

        /* ── clear ────────────────────────────────────────────────────── */
        case "clear": {
            if (!toolId) return "Uso: /permissions clear <nombre_herramienta>";
            policyEngine.removeLocalRule(toolId);
            return `🗑️ Regla eliminada para **${toolId}**. Vuelve a usar la política predeterminada.`;
        }

        /* ── pending ──────────────────────────────────────────────────── */
        case "pending": {
            const pending = getPendingRequests();
            if (pending.length === 0) return "No hay peticiones de permiso pendientes.";
            const lines = pending.map(p =>
                `  🔔 **${p.requestId}** | tool: **${p.toolId}** | "${p.description.slice(0, 60)}"`
            );
            return `**Peticiones pendientes (${pending.length}):**\n${lines.join("\n")}`;
        }

        /* ── cancel-all ───────────────────────────────────────────────── */
        case "cancel": {
            cancelAllPending();
            return "Todas las peticiones de permiso pendientes fueron canceladas.";
        }

        default:
            return [
                "**Uso: /permissions <subcomando>**",
                "  `show`              — muestra reglas locales",
                "  `allow  <tool>`     — permite siempre",
                "  `deny   <tool>`     — deniega siempre",
                "  `ask    <tool>`     — pide confirmación",
                "  `clear  <tool>`     — elimina regla local",
                "  `pending`           — lista peticiones en espera",
                "  `cancel`            — cancela todas las peticiones pendientes",
            ].join("\n");
    }
}

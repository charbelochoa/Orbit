/**
 * /mcp — Manage MCP (Model Context Protocol) servers
 *
 * /mcp list               — list configured servers + status
 * /mcp enable <name>      — connect to a server
 * /mcp disable <name>     — disconnect a server
 * /mcp logs <name>        — show server logs
 * /mcp tools [name]       — list tools from connected servers
 * /mcp reload             — reload config from disk
 */
import type { CommandHandler } from "../types.js";
import { mcpRegistry } from "../../mcp/registry.js";

export const mcpCommand: CommandHandler = async (ctx) => {
    const sub = ctx.subcommand || "list";
    const arg = ctx.args?.[0] || "";

    switch (sub) {
        case "list": {
            const servers = mcpRegistry.listServers();
            if (servers.length === 0) {
                return "No hay servidores MCP configurados.\nCrea ~/.orbit/mcp.json o .orbit/mcp.json para configurarlos.";
            }
            const lines = servers.map(s => {
                const icon = s.disabled ? "⊘" : s.connected ? "✓" : "○";
                const status = s.disabled ? "deshabilitado" : s.connected ? `conectado (${s.toolCount} tools)` : "desconectado";
                return `  ${icon} ${s.name} [${s.transport}] — ${status}`;
            });
            return `Servidores MCP (${servers.length}):\n${lines.join("\n")}`;
        }

        case "enable": {
            if (!arg) return "Uso: /mcp enable <nombre_servidor>";
            const result = await mcpRegistry.enable(arg);
            return result;
        }

        case "disable": {
            if (!arg) return "Uso: /mcp disable <nombre_servidor>";
            return mcpRegistry.disable(arg);
        }

        case "logs": {
            if (!arg) return "Uso: /mcp logs <nombre_servidor>";
            const logs = mcpRegistry.getLogs(arg, 30);
            if (logs.length === 0) return `No hay logs para '${arg}'.`;
            return `Logs de '${arg}' (últimos ${logs.length}):\n${logs.map(l => `  ${l}`).join("\n")}`;
        }

        case "tools": {
            const allTools = mcpRegistry.getAllTools();
            if (allTools.length === 0) {
                return "No hay tools MCP disponibles. Conecta un servidor con /mcp enable <nombre>.";
            }
            // Optionally filter by server name
            const filtered = arg ? allTools.filter(t => t.server === arg) : allTools;
            if (filtered.length === 0) return `No hay tools del servidor '${arg}'.`;

            const lines = filtered.map(t => `  ${t.server}/${t.name} — ${t.description?.slice(0, 60) || "sin descripción"}`);
            return `Tools MCP (${filtered.length}):\n${lines.join("\n")}`;
        }

        case "reload": {
            mcpRegistry.loadConfig();
            const servers = mcpRegistry.listServers();
            return `✓ Configuración MCP recargada. ${servers.length} servidor(es) configurado(s).`;
        }

        default:
            return `Subcomando desconocido: '${sub}'.\nUso: /mcp list|enable|disable|logs|tools|reload`;
    }
};

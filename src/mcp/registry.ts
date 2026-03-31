/**
 * MCP Server Registry — Phase 5.2
 *
 * Manages MCP server configurations and client lifecycle.
 * Config file: ~/.orbit/mcp.json (global) or .orbit/mcp.json (project)
 *
 * Example mcp.json:
 * {
 *   "servers": {
 *     "filesystem": { "command": "npx", "args": ["@modelcontextprotocol/server-filesystem", "."] },
 *     "github":     { "command": "npx", "args": ["@modelcontextprotocol/server-github"], "env": { "GITHUB_TOKEN": "${GITHUB_TOKEN}" } },
 *     "postgres":   { "url": "http://localhost:5173/sse" }
 *   }
 * }
 */
import fs from "fs";
import path from "path";
import os from "os";
import { McpClient, McpClientConfig, McpToolDefinition } from "./client.js";
import { createLogger } from "../infra/logger.js";

const log = createLogger("MCPRegistry");

// ── Config types ─────────────────────────────────────────────────────────────

interface McpServerConfig {
    command?:  string;
    args?:     string[];
    env?:      Record<string, string>;
    cwd?:      string;
    url?:      string;
    disabled?: boolean;
}

interface McpConfigFile {
    servers: Record<string, McpServerConfig>;
}

// ── Registry ─────────────────────────────────────────────────────────────────

class McpRegistry {
    private clients = new Map<string, McpClient>();
    private configs = new Map<string, McpServerConfig>();

    /** Load config from disk (merges global + project) */
    loadConfig(): void {
        const globalPath = path.join(os.homedir(), ".orbit", "mcp.json");
        const localPath = path.join(process.cwd(), ".orbit", "mcp.json");

        this.configs.clear();

        // Load global first
        this.loadConfigFile(globalPath);
        // Project config overrides global
        this.loadConfigFile(localPath);

        log.info(`MCP config loaded: ${this.configs.size} server(s)`);
    }

    private loadConfigFile(filePath: string): void {
        if (!fs.existsSync(filePath)) return;
        try {
            const raw = fs.readFileSync(filePath, "utf-8");
            const config: McpConfigFile = JSON.parse(raw);
            if (config.servers) {
                for (const [name, cfg] of Object.entries(config.servers)) {
                    this.configs.set(name, cfg);
                }
            }
        } catch (e: any) {
            log.warn(`Error loading ${filePath}: ${e.message}`);
        }
    }

    /** List all configured servers with connection status */
    listServers(): Array<{
        name: string;
        transport: string;
        connected: boolean;
        disabled: boolean;
        toolCount: number;
    }> {
        const result: Array<{
            name: string;
            transport: string;
            connected: boolean;
            disabled: boolean;
            toolCount: number;
        }> = [];

        for (const [name, cfg] of this.configs) {
            const client = this.clients.get(name);
            result.push({
                name,
                transport: cfg.url ? "sse" : "stdio",
                connected: client?.connected || false,
                disabled: cfg.disabled || false,
                toolCount: client?.tools.length || 0,
            });
        }

        return result;
    }

    /** Enable and connect to a server */
    async enable(name: string): Promise<string> {
        const cfg = this.configs.get(name);
        if (!cfg) return `Servidor MCP '${name}' no encontrado en la configuración.`;

        // Already connected?
        if (this.clients.has(name) && this.clients.get(name)!.connected) {
            return `Servidor '${name}' ya está conectado.`;
        }

        const clientConfig: McpClientConfig = {
            name,
            transport: cfg.url ? "sse" : "stdio",
            command: cfg.command,
            args: cfg.args,
            env: cfg.env,
            cwd: cfg.cwd,
            url: cfg.url,
        };

        const client = new McpClient(clientConfig);

        client.on("connected", (info: any) => {
            log.info(`MCP '${name}' connected: ${info.name} v${info.version}`);
        });

        client.on("disconnected", () => {
            log.info(`MCP '${name}' disconnected`);
            this.clients.delete(name);
        });

        try {
            await client.connect();
            this.clients.set(name, client);

            const tools = client.tools;
            return `✓ Servidor '${name}' conectado (${tools.length} tool${tools.length !== 1 ? "s" : ""})`;
        } catch (e: any) {
            return `✗ Error conectando '${name}': ${e.message}`;
        }
    }

    /** Disable and disconnect a server */
    disable(name: string): string {
        const client = this.clients.get(name);
        if (!client) return `Servidor '${name}' no está conectado.`;

        client.disconnect();
        this.clients.delete(name);
        return `✓ Servidor '${name}' desconectado.`;
    }

    /** Get logs for a server */
    getLogs(name: string, count = 50): string[] {
        const client = this.clients.get(name);
        if (!client) return [`Servidor '${name}' no está conectado.`];
        return client.logs.slice(-count);
    }

    /** Get all tools exposed by connected MCP servers */
    getAllTools(): Array<McpToolDefinition & { server: string }> {
        const tools: Array<McpToolDefinition & { server: string }> = [];
        for (const [name, client] of this.clients) {
            if (!client.connected) continue;
            for (const tool of client.tools) {
                tools.push({ ...tool, server: name });
            }
        }
        return tools;
    }

    /** Call a tool on a specific server */
    async callTool(serverName: string, toolName: string, args: Record<string, any>): Promise<any> {
        const client = this.clients.get(serverName);
        if (!client || !client.connected) {
            throw new Error(`Servidor MCP '${serverName}' no está conectado.`);
        }
        return client.callTool(toolName, args);
    }

    /** Find which server owns a tool and call it */
    async callToolByName(toolName: string, args: Record<string, any>): Promise<any> {
        for (const [name, client] of this.clients) {
            if (!client.connected) continue;
            const hasTool = client.tools.some(t => t.name === toolName);
            if (hasTool) {
                return client.callTool(toolName, args);
            }
        }
        throw new Error(`Tool MCP '${toolName}' no encontrada en ningún servidor conectado.`);
    }

    /** Disconnect all servers */
    disconnectAll(): void {
        for (const [name, client] of this.clients) {
            log.info(`Disconnecting MCP '${name}'`);
            client.disconnect();
        }
        this.clients.clear();
    }

    /** Auto-connect all non-disabled servers */
    async autoConnect(): Promise<string[]> {
        const results: string[] = [];
        for (const [name, cfg] of this.configs) {
            if (cfg.disabled) continue;
            const msg = await this.enable(name);
            results.push(msg);
        }
        return results;
    }
}

// ── Singleton ────────────────────────────────────────────────────────────────

export const mcpRegistry = new McpRegistry();

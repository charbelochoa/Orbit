/**
 * MCP (Model Context Protocol) Client — Phase 5.1
 *
 * Implements JSON-RPC 2.0 over:
 *  - stdio transport (spawn child process, communicate via stdin/stdout)
 *  - HTTP+SSE transport (connect to remote server)
 *
 * Exposes MCP tools as Orbit tools automatically.
 */
import { spawn, ChildProcess } from "child_process";
import { EventEmitter } from "events";
import { createLogger } from "../infra/logger.js";

const log = createLogger("MCP");

// ── JSON-RPC 2.0 Types ──────────────────────────────────────────────────────

interface JsonRpcRequest {
    jsonrpc: "2.0";
    id:      number;
    method:  string;
    params?: any;
}

interface JsonRpcResponse {
    jsonrpc: "2.0";
    id:      number;
    result?: any;
    error?:  { code: number; message: string; data?: any };
}

interface JsonRpcNotification {
    jsonrpc: "2.0";
    method:  string;
    params?: any;
}

// ── MCP Types ────────────────────────────────────────────────────────────────

export interface McpToolDefinition {
    name:        string;
    description: string;
    inputSchema: Record<string, any>;
}

export interface McpResource {
    uri:         string;
    name:        string;
    description?: string;
    mimeType?:   string;
}

export interface McpServerInfo {
    name:    string;
    version: string;
}

export type McpTransport = "stdio" | "sse";

export interface McpClientConfig {
    name:       string;
    transport:  McpTransport;
    // stdio
    command?:   string;
    args?:      string[];
    env?:       Record<string, string>;
    cwd?:       string;
    // sse
    url?:       string;
}

// ── MCP Client ───────────────────────────────────────────────────────────────

export class McpClient extends EventEmitter {
    private config: McpClientConfig;
    private _connected = false;
    private _serverInfo: McpServerInfo | null = null;
    private _tools: McpToolDefinition[] = [];
    private _resources: McpResource[] = [];

    // stdio
    private process: ChildProcess | null = null;
    private buffer = "";
    private nextId = 1;
    private pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>();

    // sse
    private sseAbort: AbortController | null = null;

    private _logs: string[] = [];

    constructor(config: McpClientConfig) {
        super();
        this.config = config;
    }

    get connected(): boolean { return this._connected; }
    get serverInfo(): McpServerInfo | null { return this._serverInfo; }
    get tools(): McpToolDefinition[] { return [...this._tools]; }
    get resources(): McpResource[] { return [...this._resources]; }
    get logs(): string[] { return [...this._logs]; }
    get name(): string { return this.config.name; }

    private log(msg: string): void {
        const entry = `[${new Date().toISOString()}] ${msg}`;
        this._logs.push(entry);
        if (this._logs.length > 200) this._logs.shift();
        log.debug(`[${this.config.name}] ${msg}`);
    }

    // ── Connect ──────────────────────────────────────────────────────────────

    async connect(): Promise<void> {
        if (this.config.transport === "stdio") {
            await this.connectStdio();
        } else {
            await this.connectSSE();
        }
    }

    // ── stdio transport ──────────────────────────────────────────────────────

    private async connectStdio(): Promise<void> {
        if (!this.config.command) throw new Error("stdio transport requires 'command'");

        this.log(`Spawning: ${this.config.command} ${(this.config.args || []).join(" ")}`);

        // Merge env, resolving ${VAR} references
        const env = { ...process.env };
        if (this.config.env) {
            for (const [k, v] of Object.entries(this.config.env)) {
                env[k] = v.replace(/\$\{(\w+)\}/g, (_, name) => process.env[name] || "");
            }
        }

        this.process = spawn(this.config.command, this.config.args || [], {
            stdio: ["pipe", "pipe", "pipe"],
            env,
            cwd: this.config.cwd,
            shell: true,
        });

        this.process.stdout!.on("data", (chunk: Buffer) => {
            this.buffer += chunk.toString();
            this.processBuffer();
        });

        this.process.stderr!.on("data", (chunk: Buffer) => {
            this.log(`stderr: ${chunk.toString().trim()}`);
        });

        this.process.on("close", (code) => {
            this.log(`Process exited with code ${code}`);
            this._connected = false;
            this.emit("disconnected", code);
        });

        this.process.on("error", (err) => {
            this.log(`Process error: ${err.message}`);
            this._connected = false;
        });

        // Initialize MCP handshake
        await this.initialize();
    }

    private processBuffer(): void {
        // JSON-RPC messages are newline-delimited
        const lines = this.buffer.split("\n");
        this.buffer = lines.pop() || "";

        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) continue;
            try {
                const msg = JSON.parse(trimmed);
                this.handleMessage(msg);
            } catch (e) {
                this.log(`Parse error: ${trimmed.slice(0, 100)}`);
            }
        }
    }

    // ── SSE transport ────────────────────────────────────────────────────────

    private async connectSSE(): Promise<void> {
        if (!this.config.url) throw new Error("SSE transport requires 'url'");

        this.log(`Connecting to SSE: ${this.config.url}`);
        this.sseAbort = new AbortController();

        // Start SSE listener in background
        this.startSSEListener();

        // Initialize MCP handshake
        await this.initialize();
    }

    private async startSSEListener(): Promise<void> {
        const url = this.config.url!;
        try {
            const res = await fetch(url, {
                headers: { Accept: "text/event-stream" },
                signal: this.sseAbort!.signal,
            });

            if (!res.ok || !res.body) {
                this.log(`SSE connection failed: HTTP ${res.status}`);
                return;
            }

            const reader = res.body.getReader();
            const decoder = new TextDecoder();
            let buffer = "";

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                buffer += decoder.decode(value, { stream: true });
                const events = buffer.split("\n\n");
                buffer = events.pop() || "";

                for (const event of events) {
                    const dataLine = event.split("\n").find(l => l.startsWith("data: "));
                    if (dataLine) {
                        try {
                            const msg = JSON.parse(dataLine.slice(6));
                            this.handleMessage(msg);
                        } catch {
                            this.log(`SSE parse error: ${dataLine.slice(0, 100)}`);
                        }
                    }
                }
            }
        } catch (e: any) {
            if (e.name !== "AbortError") {
                this.log(`SSE error: ${e.message}`);
            }
        }
    }

    // ── Message handling ─────────────────────────────────────────────────────

    private handleMessage(msg: any): void {
        if (msg.id !== undefined && this.pending.has(msg.id)) {
            // Response to a request we sent
            const { resolve, reject } = this.pending.get(msg.id)!;
            this.pending.delete(msg.id);
            if (msg.error) {
                reject(new Error(`MCP error ${msg.error.code}: ${msg.error.message}`));
            } else {
                resolve(msg.result);
            }
        } else if (msg.method) {
            // Notification from server
            this.log(`Notification: ${msg.method}`);
            this.emit("notification", msg);

            if (msg.method === "tools/list_changed") {
                this.refreshTools().catch(() => {});
            }
        }
    }

    // ── Send JSON-RPC ────────────────────────────────────────────────────────

    private async send(method: string, params?: any): Promise<any> {
        const id = this.nextId++;
        const request: JsonRpcRequest = { jsonrpc: "2.0", id, method, params };

        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                this.pending.delete(id);
                reject(new Error(`MCP timeout: ${method}`));
            }, 30000);

            this.pending.set(id, {
                resolve: (v) => { clearTimeout(timer); resolve(v); },
                reject:  (e) => { clearTimeout(timer); reject(e); },
            });

            if (this.config.transport === "stdio" && this.process?.stdin) {
                this.process.stdin.write(JSON.stringify(request) + "\n");
            } else if (this.config.transport === "sse" && this.config.url) {
                // POST to the SSE endpoint for requests
                const postUrl = this.config.url.replace(/\/sse$/, "");
                fetch(postUrl, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(request),
                }).catch(e => {
                    this.pending.delete(id);
                    clearTimeout(timer);
                    reject(e);
                });
            }
        });
    }

    // ── MCP Protocol Methods ─────────────────────────────────────────────────

    private async initialize(): Promise<void> {
        try {
            const result = await this.send("initialize", {
                protocolVersion: "2024-11-05",
                capabilities: {},
                clientInfo: { name: "orbit", version: "1.0.0" },
            });

            this._serverInfo = result?.serverInfo || { name: "unknown", version: "0" };
            this._connected = true;
            this.log(`Connected: ${this._serverInfo!.name} v${this._serverInfo!.version}`);

            // Send initialized notification
            if (this.config.transport === "stdio" && this.process?.stdin) {
                const notification: JsonRpcNotification = { jsonrpc: "2.0", method: "notifications/initialized" };
                this.process.stdin.write(JSON.stringify(notification) + "\n");
            }

            // Fetch tools and resources
            await this.refreshTools();
            await this.refreshResources();

            this.emit("connected", this._serverInfo);
        } catch (e: any) {
            this.log(`Initialize failed: ${e.message}`);
            throw e;
        }
    }

    async refreshTools(): Promise<void> {
        try {
            const result = await this.send("tools/list");
            this._tools = result?.tools || [];
            this.log(`Tools loaded: ${this._tools.length}`);
            this.emit("tools_changed", this._tools);
        } catch (e: any) {
            this.log(`tools/list failed: ${e.message}`);
        }
    }

    async refreshResources(): Promise<void> {
        try {
            const result = await this.send("resources/list");
            this._resources = result?.resources || [];
            this.log(`Resources loaded: ${this._resources.length}`);
        } catch {
            // Resources are optional
        }
    }

    /**
     * Call a tool on the MCP server.
     */
    async callTool(name: string, args: Record<string, any>): Promise<any> {
        this.log(`Calling tool: ${name}`);
        const result = await this.send("tools/call", { name, arguments: args });
        return result;
    }

    /**
     * Read a resource from the MCP server.
     */
    async readResource(uri: string): Promise<any> {
        return this.send("resources/read", { uri });
    }

    // ── Disconnect ───────────────────────────────────────────────────────────

    disconnect(): void {
        this.log("Disconnecting...");
        this._connected = false;

        if (this.process) {
            try { this.process.kill(); } catch {}
            this.process = null;
        }

        if (this.sseAbort) {
            this.sseAbort.abort();
            this.sseAbort = null;
        }

        // Reject all pending requests
        for (const [id, { reject }] of this.pending) {
            reject(new Error("Client disconnected"));
        }
        this.pending.clear();
    }
}

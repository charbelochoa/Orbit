import { WebSocketServer, WebSocket } from "ws";
import crypto from "crypto";
import { loadMemory }    from "../memory/memory-manager.js";
import { getQueue, TaskPriority } from "../agent/task-queue.js";
import { isCommand, dispatchCommand } from "../auto-reply/index.js";
import { resolvePermission, type PermissionAnswer } from "../core/permission-broker.js";

const PORT = 18789;

// ── Session auth token (generated per process lifetime) ──────────────
const SESSION_TOKEN = crypto.randomBytes(32).toString("hex");
const _authenticatedClients = new Set<string>();

/** Retrieve the session token (used by Electron/CLI to auto-authenticate). */
export function getSessionToken(): string { return SESSION_TOKEN; }

// Allowed WebSocket origins (localhost variants only)
const ALLOWED_ORIGINS = new Set([
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    `http://localhost:${PORT}`,
    `http://127.0.0.1:${PORT}`,
    undefined,  // same-machine connections with no Origin header (Electron, CLI, curl)
]);

interface Client {
    id: string;
    ws: WebSocket;
    connectedAt: Date;
    authenticated: boolean;
    // Rate limiting: message timestamps in rolling window
    msgTimestamps: number[];
}

const clients = new Map<string, Client>();

// Rate limit: max 40 messages per 60 seconds per client
const RATE_LIMIT_MAX  = 40;
const RATE_LIMIT_WINDOW = 60_000;

// Task rate limit: max 5 task submissions per 60 seconds per client
const TASK_RATE_MAX = 5;
const TASK_RATE_WINDOW = 60_000;
const _taskTimestamps = new Map<string, number[]>();

function isTaskRateLimited(clientId: string): boolean {
    const now = Date.now();
    let stamps = _taskTimestamps.get(clientId) || [];
    stamps = stamps.filter(t => now - t < TASK_RATE_WINDOW);
    if (stamps.length >= TASK_RATE_MAX) {
        _taskTimestamps.set(clientId, stamps);
        return true;
    }
    stamps.push(now);
    _taskTimestamps.set(clientId, stamps);
    return false;
}

// ─── Session-level token tracking ──────────────────────────────────
// Accumulated across the whole server session (reset on restart)
let _sessionInputTokens  = 0;
let _sessionOutputTokens = 0;
let _sessionTotalTokens  = 0;
let _contextWindow       = 1_000_000; // updated when provider info is available

/** Called by index.ts when Gemini returns usageMetadata */
export function updateTokenUsage(inputTokens: number, outputTokens: number, contextWindow?: number): void {
    _sessionInputTokens  += inputTokens;
    _sessionOutputTokens += outputTokens;
    _sessionTotalTokens   = _sessionInputTokens + _sessionOutputTokens;
    if (contextWindow) _contextWindow = contextWindow;
    broadcast({
        type:          "token_usage",
        inputTokens:   _sessionInputTokens,
        outputTokens:  _sessionOutputTokens,
        totalTokens:   _sessionTotalTokens,
        contextWindow: _contextWindow,
    });
}

/** Reset counters (e.g. on /clear) */
export function resetTokenUsage(): void {
    _sessionInputTokens  = 0;
    _sessionOutputTokens = 0;
    _sessionTotalTokens  = 0;
}

/** Read-only accessors for /cost command */
export function getTokenState() {
    return {
        inputTokens:  _sessionInputTokens,
        outputTokens: _sessionOutputTokens,
        totalTokens:  _sessionTotalTokens,
        contextWindow: _contextWindow,
    };
}

function isRateLimited(client: Client): boolean {
    const now = Date.now();
    // Remove timestamps outside the window
    client.msgTimestamps = client.msgTimestamps.filter(t => now - t < RATE_LIMIT_WINDOW);
    if (client.msgTimestamps.length >= RATE_LIMIT_MAX) return true;
    client.msgTimestamps.push(now);
    return false;
}

export function startGateway(speakFn?: (text: string) => void) {
    const wss = new WebSocketServer({ port: PORT });

    wss.on("listening", () => {
        console.log(`[Gateway] WebSocket Gateway escuchando en ws://localhost:${PORT}`);
    });

    wss.on("connection", (ws, req) => {
        // Origin validation — reject connections from unexpected origins
        const origin = req.headers.origin;
        if (!ALLOWED_ORIGINS.has(origin)) {
            console.warn(`[Gateway] Conexión rechazada — origen no permitido: ${origin}`);
            ws.close(1008, "Origin not allowed");
            return;
        }

        const id = `client_${Date.now()}`;

        // Check for auth token in URL query: ws://localhost:18789?token=<SESSION_TOKEN>
        const url = new URL(req.url || "/", `http://localhost:${PORT}`);
        const token = url.searchParams.get("token");
        const tokenValid = token !== null && token.length === SESSION_TOKEN.length &&
            crypto.timingSafeEqual(
                Buffer.from(token, "utf-8"),
                Buffer.from(SESSION_TOKEN, "utf-8"),
            );
        // Auto-authenticate same-machine clients with no Origin header (Electron, CLI, curl)
        const isLocalNoOrigin = origin === undefined;
        const preAuth = tokenValid || isLocalNoOrigin;

        clients.set(id, { id, ws, connectedAt: new Date(), authenticated: preAuth, msgTimestamps: [] });
        console.log(`[Gateway] Cliente conectado: ${id} (auth: ${preAuth}, total: ${clients.size})`);
        ws.send(JSON.stringify({ type: "connected", clientId: id, authenticated: preAuth, message: "Bienvenido a Orbit Gateway" }));

        ws.on("message", async (data) => {
            try {
                const client = clients.get(id);
                if (!client) return;
                if (isRateLimited(client)) {
                    ws.send(JSON.stringify({ type: "error", message: "Rate limit: demasiados mensajes. Espera un momento." }));
                    return;
                }
                const msg = JSON.parse(data.toString());

                // Handle auth message for clients that didn't pass token in URL
                if (msg.type === "auth") {
                    const valid = typeof msg.token === "string" && msg.token.length === SESSION_TOKEN.length &&
                        crypto.timingSafeEqual(Buffer.from(msg.token, "utf-8"), Buffer.from(SESSION_TOKEN, "utf-8"));
                    client.authenticated = valid;
                    ws.send(JSON.stringify({ type: "auth_result", success: valid }));
                    if (!valid) console.warn(`[Gateway] Auth fallida para ${id}`);
                    return;
                }

                // Require auth for mutating operations
                if (!client.authenticated && msg.type !== "ping" && msg.type !== "status") {
                    ws.send(JSON.stringify({ type: "error", message: "No autenticado. Envía {type:'auth', token:'...'} primero." }));
                    return;
                }

                await handleClientMessage(id, msg, speakFn);
            } catch (e: any) {
                ws.send(JSON.stringify({ type: "error", message: `JSON invalido: ${e.message}` }));
            }
        });

        ws.on("close", () => {
            clients.delete(id);
            console.log(`[Gateway] Cliente desconectado: ${id}`);
        });

        ws.on("error", (err) => {
            console.error(`[Gateway] Error en cliente ${id}:`, err.message);
        });
    });
}

async function handleClientMessage(clientId: string, msg: any, speakFn?: (text: string) => void) {
    const client = clients.get(clientId);
    if (!client) return;
    const { type, payload } = msg;
    console.log(`[Gateway] Mensaje de ${clientId}: type=${type}`);

    switch (type) {
        case "ping":
            client.ws.send(JSON.stringify({ type: "pong", timestamp: new Date().toISOString() }));
            break;

        case "chat": {
            const text = payload?.text || "";
            broadcast({ type: "user_message", text });
            // Phase 6: route /commands to the dispatcher; plain text goes to Gemini
            if (isCommand(text)) {
                await dispatchCommand(text, clientId, client.ws, speakFn);
            } else if (speakFn) {
                // speak is async — fire and let it resolve (handles its own errors)
                Promise.resolve(speakFn(text)).catch(() => {});
            }
            break;
        }

        case "task": {
            if (isTaskRateLimited(clientId)) {
                client.ws.send(JSON.stringify({ type: "error", message: "Rate limit de tareas: máximo 5 tareas por minuto." }));
                break;
            }
            const goal = payload?.goal || "";
            const priority = payload?.priority === "high"
                ? TaskPriority.HIGH
                : payload?.priority === "low"
                    ? TaskPriority.LOW
                    : TaskPriority.NORMAL;
            const taskId = getQueue().submit(goal, priority, (update: string) => {
                broadcast({ type: "task_update", taskId, message: update });
            });
            client.ws.send(JSON.stringify({ type: "task_queued", taskId }));
            break;
        }

        case "memory": {
            const mem = await loadMemory();
            client.ws.send(JSON.stringify({ type: "memory", data: mem }));
            break;
        }

        case "status": {
            const tasks = getQueue().listAll();
            client.ws.send(JSON.stringify({
                type: "status",
                tasks: tasks.map(t => ({
                    id: t.id,
                    goal: t.goal.slice(0, 60),
                    status: t.status,
                    priority: t.priority
                })),
                tokensUsed:    _sessionTotalTokens,
                inputTokens:   _sessionInputTokens,
                outputTokens:  _sessionOutputTokens,
                contextWindow: _contextWindow,
            }));
            break;
        }

        case "permission_response": {
            const requestId = payload?.requestId as string;
            const answer    = (payload?.answer || "deny") as PermissionAnswer;
            const ok = resolvePermission(requestId, answer);
            client.ws.send(JSON.stringify({ type: "permission_ack", requestId, ok }));
            break;
        }

        // ── Sprint 12: Electron presence signal ───────────────────────────
        case "electron_connected": {
            const connected = msg.value ?? true;
            _electronConnectedHandler?.(connected);
            break;
        }

        default:
            client.ws.send(JSON.stringify({ type: "error", message: `Tipo de mensaje desconocido: ${type}` }));
    }
}

export function broadcast(msg: any) {
    const json = JSON.stringify(msg);
    clients.forEach(client => {
        if (client.ws.readyState === WebSocket.OPEN) {
            client.ws.send(json);
        }
    });
    // Internal subscribers (e.g. NotificationService)
    for (const cb of _internalListeners) {
        try { cb(msg); } catch { /* ignore listener errors */ }
    }
}

// ── Internal broadcast bus ─────────────────────────────────────────────────
const _internalListeners: Array<(msg: any) => void> = [];

/** Sprint 12: called when Electron signals it's connected */
let _electronConnectedHandler: ((connected: boolean) => void) | null = null;
export function onElectronConnected(cb: (connected: boolean) => void): void {
    _electronConnectedHandler = cb;
}

/**
 * Subscribe to all broadcast events internally (no WebSocket needed).
 * Returns an unsubscribe function.
 */
export function onBroadcast(cb: (msg: any) => void): () => void {
    _internalListeners.push(cb);
    return () => {
        const idx = _internalListeners.indexOf(cb);
        if (idx >= 0) _internalListeners.splice(idx, 1);
    };
}

export function setTypingState(state: "thinking" | "executing" | "idle", tool?: string) {
    broadcast({ type: "typing", state, tool });
}

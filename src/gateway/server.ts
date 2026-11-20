import { WebSocketServer, WebSocket } from "ws";
import crypto from "crypto";
import { loadMemory }    from "../memory/memory-manager.js";
import { getQueue, TaskPriority } from "../agent/task-queue.js";
import { isCommand, dispatchCommand } from "../auto-reply/index.js";
import { resolvePermission } from "../core/permission-broker.js";
import { loopRegistry } from "../agent/loop-registry.js";
import { browserControl } from "../actions/browser-control.js";
import { clearHistory } from "../memory/chat-history.js";
import { providerRegistry } from "../providers/registry.js";

// ── Session auth token (generated per process lifetime) ──────────────
const SESSION_TOKEN = crypto.randomBytes(32).toString("hex");
const _authenticatedClients = new Set<string>();

/** Retrieve the session token (used by Electron/CLI to auto-authenticate). */
export function getSessionToken(): string { return SESSION_TOKEN; }

interface Client {
    id: string;
    ws: WebSocket;
    connectedAt: Date;
    authenticated: boolean;
    turn?: AbortController;
    // Rate limiting: message timestamps in rolling window
    msgTimestamps: number[];
}

export interface ChatTurn {
    text: string;
    sessionId: string;
    signal: AbortSignal;
    provider?: string;
    send: (message: Record<string, unknown>) => void;
}

type TurnContext = Pick<ChatTurn, "sessionId" | "signal" | "send">;
export type VoiceTurn = TurnContext & { data: string };
type ChatHandler = (turn: ChatTurn) => Promise<void>;
type VoiceHandler = (turn: VoiceTurn) => Promise<void>;

async function runClientTurn(
    client: Client,
    conversationId: unknown,
    handle: (context: TurnContext) => Promise<void>,
) {
    const send = (message: Record<string, unknown>) => {
        if (client.ws.readyState === WebSocket.OPEN) client.ws.send(JSON.stringify(message));
    };
    if (client.turn) {
        send({ type: "error", message: "Ya hay un turno en curso." });
        return;
    }
    client.turn = new AbortController();
    try {
        await handle({ sessionId: sessionKey(client, conversationId), signal: client.turn.signal, send });
    } finally {
        client.turn = undefined;
    }
}

function sessionKey(client: Client, id: unknown): string {
    const conversation = typeof id === "string" && /^[\w-]{1,100}$/.test(id) ? id : client.id;
    return `chat:${conversation}`;
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

export async function startGateway(
    speakFn: (text: string) => void,
    chat: ChatHandler,
    voice: VoiceHandler,
    { gatewayPort, webPort }: { gatewayPort: number; webPort: number },
) {
    const allowedOrigins = new Set([undefined, `http://127.0.0.1:${webPort}`, `http://localhost:${webPort}`]);
    const wss = new WebSocketServer({ port: gatewayPort, host: "127.0.0.1", maxPayload: 4 * 1024 * 1024 });

    wss.on("listening", () => {
        console.log(`[Gateway] WebSocket Gateway escuchando en ws://127.0.0.1:${gatewayPort}`);
    });

    wss.on("connection", (ws, req) => {
        // Origin validation — reject connections from unexpected origins
        const origin = req.headers.origin;
        if (!allowedOrigins.has(origin)) {
            console.warn(`[Gateway] Conexión rechazada — origen no permitido: ${origin}`);
            ws.close(1008, "Origin not allowed");
            return;
        }

        const id = crypto.randomUUID();

        // Check for auth token in URL query: ws://localhost:18789?token=<SESSION_TOKEN>
        const url = new URL(req.url || "/", `http://127.0.0.1:${gatewayPort}`);
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
                if (!client.authenticated && msg.type !== "ping") {
                    ws.send(JSON.stringify({ type: "error", message: "No autenticado. Envía {type:'auth', token:'...'} primero." }));
                    return;
                }

                await handleClientMessage(id, msg, speakFn, chat, voice);
            } catch (e: any) {
                ws.send(JSON.stringify({ type: "error", message: `JSON invalido: ${e.message}` }));
            }
        });

        ws.on("close", () => {
            clients.get(id)?.turn?.abort();
            clients.delete(id);
            _taskTimestamps.delete(id);
            console.log(`[Gateway] Cliente desconectado: ${id}`);
        });

        ws.on("error", (err) => {
            console.error(`[Gateway] Error en cliente ${id}:`, err.message);
        });
    });
    await new Promise<void>((resolve, reject) => {
        wss.once("listening", resolve);
        wss.once("error", reject);
    });
    return wss;
}

async function handleClientMessage(clientId: string, msg: any, speakFn: (text: string) => void, chat: ChatHandler, voice: VoiceHandler) {
    const client = clients.get(clientId);
    if (!client) return;
    const { type, payload } = msg;
    console.log(`[Gateway] Mensaje de ${clientId}: type=${type}`);

    switch (type) {
        case "ping":
            client.ws.send(JSON.stringify({ type: "pong", timestamp: new Date().toISOString() }));
            break;

        case "chat": {
            const text = typeof payload?.text === "string" ? payload.text.trim() : "";
            const send = (message: Record<string, unknown>) => {
                if (client.ws.readyState === WebSocket.OPEN) client.ws.send(JSON.stringify(message));
            };
            if (text.toLowerCase() === "/stop") {
                if (client.turn) client.turn.abort();
                else send({ type: "turn_complete" });
                break;
            }
            if (!text || text.length > 32_000) {
                send({ type: "error", message: "Escribe un mensaje de hasta 32 000 caracteres." });
                send({ type: "turn_complete" });
                break;
            }
            if (isCommand(text)) {
                if (text.toLowerCase() === "/clear" && !client.turn) clearHistory(sessionKey(client, payload?.conversationId));
                await dispatchCommand(text, clientId, client.ws, speakFn);
                break;
            }
            const provider = typeof payload?.provider === "string" ? payload.provider : undefined;
            await runClientTurn(client, payload?.conversationId, context => chat({ ...context, text, provider }));
            break;
        }

        case "audio": {
            const data = payload?.pcm;
            if (typeof data !== "string" || data.length > 1_280_000 || data.length % 4 !== 0 || !/^[A-Za-z0-9+/]+=*$/.test(data)) {
                client.ws.send(JSON.stringify({ type: "error", message: "Orbit recibió audio inválido." }));
                break;
            }
            await runClientTurn(client, payload?.conversationId, context => voice({ ...context, data }));
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
            const provider = providerRegistry.getActiveInfo();
            client.ws.send(JSON.stringify({
                type: "status",
                provider: provider.name,
                providerId: provider.id,
                gemini: providerRegistry.get("gemini")?.isAvailable() ?? false,
                python: process.env.ORBIT_VISION_ENGINE === "1",
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

        case "history_delete": {
            const id = payload?.conversationId;
            if (typeof id === "string" && /^conv_[\w-]{1,95}$/.test(id)) clearHistory(`chat:${id}`);
            break;
        }

        case "permission_response": {
            const requestId = payload?.requestId;
            const answer = payload?.answer;
            if (typeof requestId !== "string" || !["allow", "always", "deny"].includes(answer)) break;
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

        // ── Phase 4: Pause/Resume controls ────────────────────────────────
        case "visual_pause": {
            const loopId = payload?.id as string | undefined;
            const loop = loopId ? loopRegistry.get(loopId) : loopRegistry.getActive();
            if (loop) {
                loop.pause();
                client.ws.send(JSON.stringify({ type: "visual_pause_ack", ok: true }));
            } else {
                client.ws.send(JSON.stringify({ type: "visual_pause_ack", ok: false, reason: "No hay loop activo" }));
            }
            break;
        }

        case "visual_resume": {
            const loopId = payload?.id as string | undefined;
            const loop = loopId ? loopRegistry.get(loopId) : loopRegistry.getActive();
            if (loop) {
                loop.resume();
                client.ws.send(JSON.stringify({ type: "visual_resume_ack", ok: true }));
            } else {
                client.ws.send(JSON.stringify({ type: "visual_resume_ack", ok: false, reason: "No hay loop activo" }));
            }
            break;
        }

        case "visual_stop": {
            const loopId = payload?.id as string | undefined;
            const loop = loopId ? loopRegistry.get(loopId) : loopRegistry.getActive();
            if (loop) {
                loop.stop();
                client.ws.send(JSON.stringify({ type: "visual_stop_ack", ok: true }));
            } else {
                client.ws.send(JSON.stringify({ type: "visual_stop_ack", ok: false, reason: "No hay loop activo" }));
            }
            break;
        }

        case "task_pause": {
            const taskId = payload?.id as string;
            const ok = taskId ? getQueue().pause(taskId) : false;
            client.ws.send(JSON.stringify({ type: "task_pause_ack", id: taskId, ok }));
            break;
        }

        case "task_resume": {
            const taskId = payload?.id as string;
            const ok = taskId ? getQueue().resume(taskId) : false;
            client.ws.send(JSON.stringify({ type: "task_resume_ack", id: taskId, ok }));
            break;
        }

        // ── Fase 5: Batch pipeline ────────────────────────────────────────
        case "batch": {
            if (isTaskRateLimited(clientId)) {
                client.ws.send(JSON.stringify({ type: "error", message: "Rate limit: máximo 5 tareas por minuto." }));
                break;
            }
            const goals: string[] = Array.isArray(payload?.goals) ? payload.goals : [];
            if (!goals.length) {
                client.ws.send(JSON.stringify({ type: "error", message: "batch: se requiere 'goals' (array de strings)" }));
                break;
            }
            const priority = payload?.priority === "high"
                ? TaskPriority.HIGH
                : payload?.priority === "low"
                    ? TaskPriority.LOW
                    : TaskPriority.NORMAL;
            const taskIds: string[] = [];
            for (const goal of goals) {
                if (typeof goal !== "string" || !goal.trim()) continue;
                const taskId = getQueue().submit(goal.trim(), priority, (update: string) => {
                    broadcast({ type: "task_update", taskId, message: update });
                });
                taskIds.push(taskId);
            }
            client.ws.send(JSON.stringify({ type: "batch_queued", taskIds, count: taskIds.length }));
            break;
        }
// ── Fase 6: Browser Pipeline ────────────────────────────────
        case "browser_pipeline": {
            const steps: any[] = Array.isArray(payload?.steps) ? payload.steps : [];
            if (!steps.length) {
                client.ws.send(JSON.stringify({ type: "error", message: "browser_pipeline: se requiere 'steps' (array de acciones)" }));
                break;
            }
            const stopOnError = payload?.stop_on_error !== false;
            const results: Array<{ step: number; action: string; result: string }> = [];
            for (let i = 0; i < steps.length; i++) {
                const step = steps[i];
                try {
                    const stepResult = await browserControl(step);
                    results.push({ step: i, action: step.action ?? "?", result: stepResult });
                    // Broadcast progress
                    broadcast({ type: "browser_pipeline_step", step: i, total: steps.length, action: step.action, result: stepResult });
                } catch (e: any) {
                    results.push({ step: i, action: step.action ?? "?", result: `Error: ${e.message}` });
                    broadcast({ type: "browser_pipeline_step", step: i, total: steps.length, action: step.action, result: `Error: ${e.message}` });
                    if (stopOnError) break;
                }
            }
            client.ws.send(JSON.stringify({ type: "browser_pipeline_result", results, count: results.length }));
            break;
        }

        default:
            client.ws.send(JSON.stringify({ type: "error", message: `Tipo de mensaje desconocido: ${type}` }));
    }
}

export function broadcast(msg: any) {
    const json = JSON.stringify(msg);
    clients.forEach(client => {
        if (client.authenticated && client.ws.readyState === WebSocket.OPEN) {
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

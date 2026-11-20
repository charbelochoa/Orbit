import { WebSocketServer, WebSocket } from "ws";
import crypto from "crypto";
import { loadMemory }    from "../memory/memory-manager.js";
import { getQueue, TaskPriority } from "../agent/task-queue.js";
import { cancelWork, listDelegatedJobs } from "../agent/delegated-jobs.js";
import { isCommand, dispatchCommand } from "../auto-reply/index.js";
import { resolvePermission } from "../core/permission-broker.js";
import { loopRegistry } from "../agent/loop-registry.js";
import { executeTool } from "../actions/index.js";
import { runInLane } from "../agent/lanes.js";
import { getToolFailure, OrbitToolError } from "../core/orbit-error.js";
import { getConfig } from "../config/config.js";
import { toolRegistry } from "../core/registry.js";
import { clearHistory, getChatWorkspace, listChatConversations, readChatConversation } from "../memory/chat-history.js";
import { chatSessionId, isConversationId } from "../core/conversations.js";
import { providerRegistry } from "../providers/registry.js";
import { withProviderSelection } from "../providers/selection.js";
import { resolveWorkspace, withWorkspace, workspaceRoot } from "../core/workspace.js";
import { KeyedAsyncQueue } from "../infra/keyed-async-queue.js";
import { MAX_VOICE_BYTES, pcmByteLength, VoiceInput } from "../core/voice-input.js";

// ── Session auth token (generated per process lifetime) ──────────────
const SESSION_TOKEN = crypto.randomBytes(32).toString("hex");
const _authenticatedClients = new Set<string>();

function tokenMatches(value: unknown): boolean {
    return typeof value === "string" && /^[a-f0-9]{64}$/.test(value) &&
        crypto.timingSafeEqual(Buffer.from(value, "hex"), Buffer.from(SESSION_TOKEN, "hex"));
}

/** Retrieve the session token (used by Electron/CLI to auto-authenticate). */
export function getSessionToken(): string { return SESSION_TOKEN; }

interface Client {
    id: string;
    ws: WebSocket;
    connectedAt: Date;
    authenticated: boolean;
    turn?: AbortController;
    voiceInput?: { id: string; source: VoiceInput };
    // Rate limiting: message timestamps in rolling window
    msgTimestamps: number[];
}

export interface ChatTurn {
    text: string;
    sessionId: string;
    signal: AbortSignal;
    send: (message: Record<string, unknown>) => void;
}

type TurnContext = Pick<ChatTurn, "sessionId" | "signal" | "send">;
export type VoiceTurn = TurnContext & { data: string | AsyncIterable<string> };
type ChatHandler = (turn: ChatTurn) => Promise<void>;
type VoiceHandler = (turn: VoiceTurn) => Promise<void>;
const sessionTurns = new KeyedAsyncQueue();

async function runClientTurn(
    client: Client,
    conversationId: unknown,
    handle: (context: TurnContext) => Promise<void>,
    requestId?: unknown,
) {
    const send = (message: Record<string, unknown>) => {
        if (client.ws.readyState !== WebSocket.OPEN) return;
        const id = typeof requestId === "string" && /^[\w-]{1,100}$/.test(requestId) ? requestId : undefined;
        client.ws.send(JSON.stringify(id ? { ...message, requestId: id } : message));
    };
    if (client.turn) {
        send({ type: "error", message: "Ya hay un turno en curso." });
        return;
    }
    client.turn = new AbortController();
    const { signal } = client.turn;
    const sessionId = sessionKey(client, conversationId);
    try {
        await sessionTurns.enqueue(sessionId, () => handle({ sessionId, signal, send }), signal);
    } catch (error) {
        if (!signal.aborted) throw error;
        send({ type: "turn_complete" });
    } finally {
        client.turn = undefined;
    }
}

function sessionKey(client: Client, id: unknown): string {
    return chatSessionId(isConversationId(id) ? id : client.id);
}

const historyCommands = new Set(["history_list", "history_get", "history_delete"]);
const conversationCommands = new Set(["chat", "audio", "audio_start"]);

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

function handleVoicePacket(client: Client, type: string, payload: { requestId?: unknown; pcm?: unknown } | undefined): void {
    const input = client.voiceInput;
    if (!input || input.id !== payload?.requestId || client.turn?.signal.aborted) return;
    if (type === "audio_end") {
        input.source.finish();
        return;
    }
    if (type === "audio_cancel") {
        client.turn?.abort();
        input.source.discard();
        return;
    }
    try {
        const pcm = payload?.pcm;
        if (typeof pcm !== "string") throw new Error("Falta el fragmento del micrófono.");
        input.source.append(pcm);
    } catch (error) {
        client.turn?.abort(error);
        input.source.discard();
    }
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
        const tokenValid = tokenMatches(token);
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
                const msg = JSON.parse(data.toString());
                const voicePacket = ["audio_chunk", "audio_end", "audio_cancel"].includes(msg.type);
                if ((!voicePacket || !client.authenticated) && isRateLimited(client)) {
                    ws.send(JSON.stringify({ type: "error", message: "Rate limit: demasiados mensajes. Espera un momento." }));
                    return;
                }

                // Handle auth message for clients that didn't pass token in URL
                if (msg.type === "auth") {
                    const valid = tokenMatches(msg.token);
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
                if (voicePacket) {
                    handleVoicePacket(client, msg.type, msg.payload);
                    return;
                }

                let workspace: string;
                try {
                    const conversation = msg.payload?.conversationId;
                    const requested = msg.payload?.workspace ?? (conversationCommands.has(msg.type) && isConversationId(conversation)
                        ? getChatWorkspace(conversation) : undefined);
                    workspace = historyCommands.has(msg.type) ? workspaceRoot() : await resolveWorkspace(requested);
                } catch (error) {
                    ws.send(JSON.stringify({ type: "error", message: (error as Error).message }));
                    return;
                }
                const selection = ["chat", "task", "batch"].includes(msg.type)
                    ? providerRegistry.resolveRequestSelection(msg.payload?.provider, msg.payload?.model)
                    : undefined;
                await withWorkspace(workspace, () => withProviderSelection(selection, () => handleClientMessage(id, msg, speakFn, chat, voice)));
            } catch (e: any) {
                if (ws.readyState === WebSocket.OPEN) {
                    ws.send(JSON.stringify({ type: "error", message: e instanceof SyntaxError ? "Mensaje JSON inválido." : e.message }));
                }
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

export function stopGateway(server: WebSocketServer): void {
    server.close();
    for (const client of clients.values()) {
        client.turn?.abort(new Error("Orbit se está cerrando."));
    }
    clients.clear();
    for (const ws of server.clients) ws.close(1001, "Orbit se está cerrando");
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
                await runClientTurn(client, payload?.conversationId, async ({ sessionId, signal, send }) => {
                    if (text.toLowerCase() === "/clear") clearHistory(sessionId);
                    await dispatchCommand(text, clientId, client.ws, speakFn, signal);
                    send({ type: "turn_complete" });
                });
                break;
            }
            const turnSelection = providerRegistry.captureSelection();
            await runClientTurn(
                client, payload?.conversationId,
                context => withProviderSelection(turnSelection, () => chat({ ...context, text })),
                payload?.requestId,
            );
            break;
        }

        case "audio": {
            const data = payload?.pcm;
            if (typeof data !== "string" || !pcmByteLength(data, MAX_VOICE_BYTES)) {
                client.ws.send(JSON.stringify({ type: "error", message: "Orbit recibió audio inválido." }));
                break;
            }
            await runClientTurn(client, payload?.conversationId, context => voice({ ...context, data }), payload?.requestId);
            break;
        }

        case "audio_start": {
            const id = payload?.requestId;
            if (typeof id !== "string" || !/^[\w-]{1,100}$/.test(id)) {
                client.ws.send(JSON.stringify({ type: "error", message: "El turno de audio requiere un identificador válido." }));
                break;
            }
            if (client.turn || client.voiceInput) {
                client.ws.send(JSON.stringify({ type: "error", requestId: id, message: "Ya hay un turno en curso." }));
                break;
            }
            const source = new VoiceInput();
            client.voiceInput = { id, source };
            try {
                await runClientTurn(client, payload?.conversationId, async context => {
                    const discard = () => source.discard();
                    context.signal.addEventListener("abort", discard, { once: true });
                    const timer = setTimeout(() => source.finish(), 35_000);
                    try {
                        context.send({ type: "audio_started" });
                        await voice({ ...context, data: source });
                    } finally {
                        clearTimeout(timer);
                        context.signal.removeEventListener("abort", discard);
                    }
                }, id);
            } finally {
                source.discard();
                if (client.voiceInput?.id === id) client.voiceInput = undefined;
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
            const tasks = getQueue().listAll(true);
            const provider = providerRegistry.getActiveInfo();
            client.ws.send(JSON.stringify({
                type: "status",
                provider: provider.name,
                providerId: provider.id,
                model: provider.model,
                workspace: workspaceRoot(),
                gemini: providerRegistry.get("gemini")?.isAvailable() ?? false,
                python: process.env.ORBIT_VISION_ENGINE === "1",
                tasks: [...listDelegatedJobs(), ...tasks.slice(-100).reverse()],
                tokensUsed:    _sessionTotalTokens,
                inputTokens:   _sessionInputTokens,
                outputTokens:  _sessionOutputTokens,
                contextWindow: _contextWindow,
            }));
            break;
        }

        case "history_list": {
            client.ws.send(JSON.stringify({ type: "history_index", conversations: listChatConversations() }));
            break;
        }

        case "history_get": {
            const id = payload?.conversationId;
            if (!isConversationId(id)) break;
            client.ws.send(JSON.stringify({ type: "history_snapshot", ...readChatConversation(id) }));
            break;
        }

        case "history_delete": {
            const id = payload?.conversationId;
            if (!isConversationId(id)) break;
            const sessionId = chatSessionId(id);
            await sessionTurns.enqueue(sessionId, async () => { clearHistory(sessionId); });
            if (client.ws.readyState === WebSocket.OPEN) {
                client.ws.send(JSON.stringify({ type: "history_deleted", conversationId: id }));
            }
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

        case "task_continue": {
            const id = payload?.id;
            const outcome = typeof id === "string"
                ? getQueue().continueTask(id, payload?.retryInterrupted === true)
                : "unavailable";
            client.ws.send(JSON.stringify({ type: "task_continue_ack", id, outcome }));
            break;
        }

        case "task_cancel": {
            const id = payload?.id;
            const ok = typeof id === "string" && cancelWork(id);
            client.ws.send(JSON.stringify({ type: "task_cancel_ack", id, ok }));
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
            const taskIds = getQueue().submitBatch(goals, priority);
            client.ws.send(JSON.stringify({ type: "batch_queued", taskIds, count: taskIds.length }));
            break;
        }
// ── Fase 6: Browser Pipeline ────────────────────────────────
        case "browser_pipeline": {
            const steps = Array.isArray(payload?.steps) ? payload.steps : [];
            if (!steps.length || steps.length > 32) {
                client.ws.send(JSON.stringify({ type: "error", message: "Indica entre 1 y 32 acciones de navegador." }));
                break;
            }
            if (!toolRegistry.get("browser_control")?.profiles.includes(getConfig().toolProfile)) {
                client.ws.send(JSON.stringify({ type: "error", message: "El perfil activo no tiene acceso al control del navegador." }));
                break;
            }
            await runClientTurn(client, payload?.conversationId, async ({ sessionId, signal, send }) => {
                const stopOnError = payload?.stop_on_error !== false;
                const results: Array<{ step: number; action: string; result: string }> = [];
                for (const [index, args] of steps.entries()) {
                    signal.throwIfAborted();
                    const action = typeof args?.action === "string" ? args.action : "?";
                    let result: string;
                    let failure: Error | undefined;
                    try {
                        result = await runInLane(sessionId, () => executeTool("browser_control", args, signal), signal, "browser_control");
                        failure = getToolFailure(result);
                    } catch (error) {
                        failure = error instanceof Error ? error : new Error(String(error));
                        result = `Error: ${failure.message}`;
                    }
                    signal.throwIfAborted();
                    const record = { step: index, action, result };
                    results.push(record);
                    send({ type: "browser_pipeline_step", total: steps.length, ...record });
                    const denied = failure instanceof OrbitToolError && failure.code === "PERMISSION_DENIED";
                    if (denied || (failure && stopOnError)) break;
                }
                send({ type: "browser_pipeline_result", results, count: results.length });
            }, payload?.requestId);
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

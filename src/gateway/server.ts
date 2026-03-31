import { WebSocketServer, WebSocket } from "ws";
import { loadMemory }    from "../memory/memory-manager.js";
import { getQueue, TaskPriority } from "../agent/task-queue.js";
import { isCommand, dispatchCommand } from "../auto-reply/index.js";

const PORT = 18789;

interface Client {
    id: string;
    ws: WebSocket;
    connectedAt: Date;
    // Rate limiting: message timestamps in rolling window
    msgTimestamps: number[];
}

const clients = new Map<string, Client>();

// Rate limit: max 40 messages per 60 seconds per client
const RATE_LIMIT_MAX  = 40;
const RATE_LIMIT_WINDOW = 60_000;

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

    wss.on("connection", (ws) => {
        const id = `client_${Date.now()}`;
        clients.set(id, { id, ws, connectedAt: new Date(), msgTimestamps: [] });
        console.log(`[Gateway] Cliente conectado: ${id} (total: ${clients.size})`);
        ws.send(JSON.stringify({ type: "connected", clientId: id, message: "Bienvenido a Orbit Gateway" }));

        ws.on("message", async (data) => {
            try {
                const client = clients.get(id);
                if (client && isRateLimited(client)) {
                    ws.send(JSON.stringify({ type: "error", message: "Rate limit: demasiados mensajes. Espera un momento." }));
                    return;
                }
                const msg = JSON.parse(data.toString());
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
                speakFn(text);
            }
            break;
        }

        case "task": {
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
                }))
            }));
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
}

export function setTypingState(state: "thinking" | "executing" | "idle", tool?: string) {
    broadcast({ type: "typing", state, tool });
}

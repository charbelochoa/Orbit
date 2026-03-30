import { WebSocketServer, WebSocket } from "ws";
import { loadMemory, formatMemoryForPrompt } from "../memory/memory-manager.js";
import { getQueue, TaskPriority } from "../agent/task-queue.js";

const PORT = 18789;

interface Client {
    id: string;
    ws: WebSocket;
    connectedAt: Date;
}

const clients = new Map<string, Client>();

export function startGateway(speakFn?: (text: string) => void) {
    const wss = new WebSocketServer({ port: PORT });

    wss.on("listening", () => {
        console.log(`[Gateway] 🌐 WebSocket Gateway escuchando en ws://localhost:${PORT}`);
    });

    wss.on("connection", (ws) => {
        const id = `client_${Date.now()}`;
        clients.set(id, { id, ws, connectedAt: new Date() });
        console.log(`[Gateway] ✅ Cliente conectado: ${id} (total: ${clients.size})`);

        // Mensaje de bienvenida
        ws.send(JSON.stringify({ type: "connected", clientId: id, message: "Bienvenido a Orbit Gateway" }));

        ws.on("message", async (data) => {
            try {
                const msg = JSON.parse(data.toString());
                await handleClientMessage(id, msg, speakFn);
            } catch (e: any) {
                ws.send(JSON.stringify({ type: "error", message: `JSON inválido: ${e.message}` }));
            }
        });

        ws.on("close", () => {
            clients.delete(id);
            console.log(`[Gateway] ❌ Cliente desconectado: ${id}`);
        });

        ws.on("error", (err) => {
            console.error(`[Gateway] ⚠️ Error en cliente ${id}:`, err.message);
        });
    });
}

async function handleClientMessage(clientId: string, msg: any, speakFn?: (text: string) => void) {
    const client = clients.get(clientId);
    if (!client) return;

    const { type, payload } = msg;
    console.log(`[Gateway] 📨 Mensaje de ${clientId}: type=${type}`);

    switch (type) {
        case "ping":
            client.ws.send(JSON.stringify({ type: "pong", timestamp: new Date().toISOString() }));
            break;

        case "chat": {
            // Mensaje de texto directo al agente (desde la Web UI)
            const text = payload?.text || "";
            // Echo back so all clients see the user message
            broadcast({ type: "user_message", text });
            if (speakFn) speakFn(text);
            break;
        }

        case "task":
            // Encolar una tarea autónoma
            const goal = payload?.goal || "";
            const priority = payload?.priority === "high" ? TaskPriority.HIGH
                : payload?.priority === "low" ? TaskPriority.LOW
                : TaskPriority.NORMAL;

            const taskId = getQueue().submit(goal, priority, (update: string) => {
                broadcast({ type: "task_update", taskId, message: update });
            });
            client.ws.send(JSON.stringify({ type: "task_queued", taskId }));
            break;

        case "memory":
            // Consultar la memoria del usuario
            const mem = await loadMemory();
            client.ws.send(JSON.stringify({ type: "memory", data: mem }));
            break;

        case "status":
            const tasks = getQueue().listAll();
            client.ws.send(JSON.stringify({ type: "status", tasks: tasks.map(t => ({
                id: t.id, goal: t.goal.slice(0, 60), status: t.status, priority: t.priority
            })) }));
            break;

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

/**
 * Broadcast typing state to all clients.
 * UI and overlay use this to show/hide indicators.
 */
export function setTypingState(state: "thinking" | "executing" | "idle", tool?: string) {
    broadcast({ type: "typing", state, tool });
}

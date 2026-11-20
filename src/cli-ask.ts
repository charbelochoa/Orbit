import { randomUUID } from "node:crypto";
import path from "node:path";
import { parseArgs } from "node:util";
import { WebSocket } from "ws";
import { getConfig } from "./config/config.js";
import { selectConversationId } from "./core/conversations.js";

export async function runAsk(args: string[]): Promise<void> {
    const { values, positionals } = parseArgs({
        args,
        allowPositionals: true,
        options: {
            workspace: { type: "string" },
            provider: { type: "string" },
            "model-name": { type: "string" },
            port: { type: "string" },
            session: { type: "string" },
            conversation: { type: "string" },
            json: { type: "boolean" },
            help: { type: "boolean", short: "h" },
        },
    });
    if (values.help) {
        console.log("orbit ask [--workspace <ruta>] [--provider <id> [--model-name <modelo>]] [--port <n>] [--session <nombre> | --conversation <id>] [--json] <mensaje>");
        return;
    }
    if (values["model-name"] !== undefined && !values.provider) throw new Error("Usa --provider junto a --model-name.");
    const text = (positionals.length ? positionals.join(" ") : await readPrompt()).trim();
    if (!text || text.length > 32_000 || text.startsWith("/")) {
        throw new Error("Indica una solicitud en lenguaje natural de hasta 32 000 caracteres.");
    }
    const workspace = path.resolve(values.workspace || process.cwd());
    const port = values.port ? Number(values.port) : getConfig().server.gatewayPort;
    if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error("Puerto del gateway inválido.");
    const id = randomUUID();
    const conversationId = selectConversationId(workspace, values.conversation, values.session);
    const requestedWorkspace = values.conversation && !values.workspace ? undefined : workspace;
    const reply = await ask(port, id, { text, workspace: requestedWorkspace, provider: values.provider, model: values["model-name"], conversationId, requestId: id });
    console.log(values.json ? JSON.stringify({ text: reply, conversationId }) : reply);
}

async function readPrompt(): Promise<string> {
    if (process.stdin.isTTY) return "";
    process.stdin.setEncoding("utf-8");
    let text = "";
    for await (const chunk of process.stdin) {
        text += chunk;
        if (text.length > 32_000) throw new Error("La entrada supera 32 000 caracteres.");
    }
    return text;
}

function ask(port: number, id: string, payload: Record<string, unknown>): Promise<string> {
    return new Promise((resolve, reject) => {
        const ws = new WebSocket(`ws://127.0.0.1:${port}`, { handshakeTimeout: 5000 });
        const deadline = setTimeout(() => finish(new Error("Orbit no terminó la solicitud a tiempo.")), 240_000);
        let output = "";
        let settled = false;
        function finish(error?: Error) {
            if (settled) return;
            settled = true;
            clearTimeout(deadline);
            process.off("SIGINT", interrupt);
            if (error) reject(error);
            else resolve(output);
            if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) ws.close();
        }
        function interrupt() {
            process.exitCode = 130;
            finish(new Error("Solicitud cancelada."));
        }
        process.once("SIGINT", interrupt);
        ws.once("open", () => ws.send(JSON.stringify({ type: "chat", payload })));
        ws.on("message", data => {
            let message: Record<string, unknown>;
            try {
                message = JSON.parse(data.toString());
            } catch {
                finish(new Error("La respuesta del gateway no es válida."));
                return;
            }
            if (message.type === "error") {
                finish(new Error(String(message.message || "Orbit devolvió un error.")));
                return;
            }
            if (message.requestId !== id) return;
            if (message.type === "orbit_message" && typeof message.text === "string") output = message.text;
            if (message.type === "tool_call") process.stderr.write(`Orbit: ${String(message.tool)}\n`);
            if (message.type === "turn_complete") {
                finish(message.success === false || !output ? new Error(output || "Orbit no devolvió una respuesta.") : undefined);
            }
        });
        ws.once("error", () => finish(new Error("No pude conectar con Orbit. Inicia la app o ejecuta npm start.")));
        ws.once("close", () => finish(new Error("Se cerró la conexión con Orbit.")));
    });
}

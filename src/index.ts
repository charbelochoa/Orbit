import dotenv from "dotenv";
dotenv.config();

import WebSocket from "ws";
import { spawn, ChildProcess } from "child_process";
import path from "path";
import { fileURLToPath } from "url";

import { loadMemory, formatMemoryForPrompt, maybeUpdateMemoryAsync } from "./memory/memory-manager.js";
import { addMessage } from "./memory/chat-history.js";
import { startGateway, broadcast } from "./gateway/server.js";
import { startWebServer }          from "./ui/web-server.js";
import { getQueue, TaskPriority }  from "./agent/task-queue.js";
import { TOOL_DECLARATIONS }       from "./core/tool-registry.js";
import { getSystemPrompt }         from "./core/prompt.js";
import { executeTool }             from "./actions/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const GEMINI_HOST  = "generativelanguage.googleapis.com";
const MODEL        = "models/gemini-2.0-flash-exp";
const SESSION_ID   = `orbit_${Date.now()}`;

let geminiWs: WebSocket | null = null;
let isGeminiReady = false;

// Track last user / orbit texts for memory updates
let _lastUserText    = "";
let _lastOrbitText   = "";

// ─── Python Vision Engine (sidecar) ──────────────────────────────────────────
let pythonEngine: ChildProcess | null = null;

function startPythonEngine() {
    const enginePath = path.join(__dirname, "../../engine/orbit_engine.py");
    console.log("[Orbit] 🐍 Iniciando Python Vision Engine...");

    try {
        pythonEngine = spawn("python", [enginePath], {
            stdio: ["ignore", "pipe", "pipe"],
            detached: false,
        });

        pythonEngine.stdout?.on("data", (d: Buffer) => {
            const line = d.toString().trim();
            if (line) console.log(`[PyEngine] ${line}`);
        });
        pythonEngine.stderr?.on("data", (d: Buffer) => {
            const line = d.toString().trim();
            if (line) console.error(`[PyEngine] ⚠️ ${line}`);
        });
        pythonEngine.on("exit", (code) => {
            console.log(`[PyEngine] Proceso terminado (código ${code}). Reintentando en 10s...`);
            pythonEngine = null;
            setTimeout(startPythonEngine, 10000);
        });
        pythonEngine.on("error", (err) => {
            console.warn(`[PyEngine] No se pudo iniciar: ${err.message}`);
            console.warn("[PyEngine] Las funciones de visión YOLO no estarán disponibles.");
            pythonEngine = null;
        });
    } catch (e: any) {
        console.warn(`[PyEngine] Error al lanzar: ${e.message}`);
    }
}

// ─── Speak (send text to Gemini Live) ─────────────────────────────────────────
function speak(text: string) {
    if (!geminiWs || geminiWs.readyState !== WebSocket.OPEN) {
        console.warn("[Orbit] ⚠️ No puedo hablar: WebSocket Gemini no conectado.");
        return;
    }
    geminiWs.send(JSON.stringify({
        clientContent: {
            turns: [{ role: "user", parts: [{ text }] }],
            turnComplete: true
        }
    }));
}

// ─── Connect to Gemini Live API ───────────────────────────────────────────────
async function connectGemini() {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey || apiKey === "TU_API_KEY_AQUI") {
        console.error("❌ GEMINI_API_KEY no configurada. Edita el archivo .env");
        process.exit(1);
    }

    const url = `wss://${GEMINI_HOST}/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContent?key=${apiKey}`;
    geminiWs = new WebSocket(url);

    geminiWs.on("open", async () => {
        console.log("[Orbit] 🟢 Gemini Live conectado.");

        const mem    = await loadMemory();
        const memStr = formatMemoryForPrompt(mem);
        const now    = new Date().toLocaleString("es-MX", {
            weekday: "long", year: "numeric", month: "long", day: "numeric",
            hour: "2-digit", minute: "2-digit"
        });
        const systemPrompt = getSystemPrompt(memStr, now);

        geminiWs!.send(JSON.stringify({
            setup: {
                model: MODEL,
                generationConfig: {
                    responseModalities: ["AUDIO", "TEXT"],   // ← TEXT added
                    speechConfig: {
                        voiceConfig: {
                            prebuiltVoiceConfig: { voiceName: "Aoede" }
                        }
                    }
                },
                systemInstruction: { parts: [{ text: systemPrompt }] },
                tools: [{ functionDeclarations: TOOL_DECLARATIONS }]
            }
        }));
    });

    geminiWs.on("message", async (data: WebSocket.Data) => {
        const raw = Buffer.isBuffer(data) ? data.toString("utf-8") : data.toString();
        try {
            const msg = JSON.parse(raw);

            // ── Setup complete ──────────────────────────────────────────
            if (msg.setupComplete) {
                isGeminiReady = true;
                console.log("[Orbit] ✅ Sesión lista. ¡Orbit está en línea!");
                broadcast({ type: "orbit_ready", message: "Orbit está listo." });
            }

            // ── Server content (transcriptions + turn complete) ─────────
            if (msg.serverContent) {
                const sc = msg.serverContent;

                if (sc.inputTranscription?.text?.trim()) {
                    _lastUserText = sc.inputTranscription.text.trim();
                    console.log(`[👤 Usuario] ${_lastUserText}`);
                    addMessage(SESSION_ID, "user", _lastUserText);
                    broadcast({ type: "user_message", text: _lastUserText });
                }

                // Text output (when TEXT modality is included)
                if (sc.modelTurn?.parts) {
                    for (const part of sc.modelTurn.parts) {
                        if (part.text?.trim()) {
                            _lastOrbitText += part.text;
                        }
                    }
                }

                if (sc.outputTranscription?.text?.trim()) {
                    const orbitText = sc.outputTranscription.text.trim();
                    _lastOrbitText = orbitText;
                    console.log(`[🛸 Orbit] ${orbitText}`);
                    addMessage(SESSION_ID, "assistant", orbitText);
                    broadcast({ type: "orbit_message", text: orbitText });
                }

                if (sc.turnComplete) {
                    // Flush accumulated text output if any
                    if (_lastOrbitText.trim()) {
                        broadcast({ type: "orbit_message", text: _lastOrbitText.trim() });
                        addMessage(SESSION_ID, "assistant", _lastOrbitText.trim());
                        _lastOrbitText = "";
                    }
                    broadcast({ type: "turn_complete" });

                    // Background memory update
                    if (_lastUserText) {
                        maybeUpdateMemoryAsync(_lastUserText, _lastOrbitText).catch(() => {});
                    }
                }
            }

            // ── Tool calls ──────────────────────────────────────────────
            if (msg.toolCall?.functionCalls) {
                const responses = [];
                for (const call of msg.toolCall.functionCalls) {
                    console.log(`[🔧 Tool] ${call.name}`, call.args);
                    broadcast({ type: "tool_call", tool: call.name, args: call.args });

                    if (call.name === "agent_task") {
                        const goal = call.args?.goal || "";
                        const priority = call.args?.priority === "high" ? TaskPriority.HIGH
                            : call.args?.priority === "low" ? TaskPriority.LOW
                            : TaskPriority.NORMAL;
                        const taskId = getQueue().submit(goal, priority, speak);
                        responses.push({
                            id: call.id, name: call.name,
                            response: { result: `Tarea encolada (ID: ${taskId}). Te avisaré cuando termine.` }
                        });
                    } else {
                        const result = await executeTool(call.name, call.args || {});
                        broadcast({ type: "tool_result", tool: call.name, result: result.slice(0, 300) });
                        responses.push({ id: call.id, name: call.name, response: { result } });
                    }
                }
                geminiWs!.send(JSON.stringify({ toolResponse: { functionResponses: responses } }));
            }

        } catch {
            // Binary audio data or non-JSON — ignore silently
        }
    });

    geminiWs.on("close", (code) => {
        isGeminiReady = false;
        console.log(`[Orbit] 🔴 Gemini desconectado (${code}). Reconectando en 5s...`);
        setTimeout(connectGemini, 5000);
    });

    geminiWs.on("error", (err) => {
        console.error("[Orbit] ❌ Error WebSocket Gemini:", err.message);
    });
}

// ─── Entry Point ──────────────────────────────────────────────────────────────
async function main() {
    console.log(`
╔══════════════════════════════════════╗
║   🛸  ORBIT AI  —  Local Assistant   ║
║   Tu mejor amigo en la computadora   ║
╚══════════════════════════════════════╝
`);

    // 1. Start HTTP server for Web UI (port 3000)
    startWebServer(3000);

    // 2. Start WebSocket Gateway for UI ↔ Orbit (port 18789)
    startGateway(speak);

    // 3. Start Python YOLO Vision Engine sidecar
    startPythonEngine();

    // 4. Connect to Gemini Live API
    await connectGemini();

    // 5. Graceful shutdown
    process.on("SIGINT", () => {
        console.log("\n[Orbit] 👋 Cerrando Orbit...");
        if (pythonEngine) pythonEngine.kill();
        process.exit(0);
    });
    process.on("SIGTERM", () => {
        if (pythonEngine) pythonEngine.kill();
        process.exit(0);
    });
}

main().catch((e) => {
    console.error("❌ Error fatal al iniciar Orbit:", e);
    process.exit(1);
});

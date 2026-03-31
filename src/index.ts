import dotenv from "dotenv";
dotenv.config();

import { GoogleGenAI, Modality } from "@google/genai";
import { spawn, ChildProcess } from "child_process";
import path from "path";
import { fileURLToPath } from "url";

import { loadMemory, formatMemoryForPrompt, maybeUpdateMemoryAsync, startMemoryAutoSave } from "./memory/memory-manager.js";
import { addMessage } from "./memory/chat-history.js";
import { startGateway, broadcast, setTypingState } from "./gateway/server.js";
import { startWebServer } from "./ui/web-server.js";
import { getQueue, TaskPriority } from "./agent/task-queue.js";
import { TOOL_DECLARATIONS } from "./core/tool-registry.js";
import { toolRegistry } from "./core/registry.js";
import { getSystemPrompt } from "./core/prompt.js";
import { executeTool } from "./actions/index.js";
import { killPS } from "./actions/ps-bridge.js";
import { loadConfig, getConfig } from "./config/config.js";
import { setLogLevel } from "./infra/logger.js";
import { createLogger } from "./infra/logger.js";
import { providerRegistry } from "./providers/registry.js";
import { loadAllPlugins }   from "./plugins/loader.js";
import { loadAllSkills }    from "./skills/loader.js";
import { initAutoReply }    from "./auto-reply/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const log = createLogger("Orbit");

// Load config early — merges orbit.yaml + .env
const config = loadConfig();
setLogLevel(config.logging.level);

const MODEL = config.providers.gemini.models["live"] || "gemini-2.5-flash-native-audio-latest";
const SESSION_ID = `orbit_${Date.now()}`;
let geminiSession: any = null;
let isGeminiReady = false;
let _geminiReconnectDelay = 2000;
const GEMINI_MAX_RECONNECT_DELAY = 60000;
let _lastUserText = "";
let _lastOrbitText = "";

// Python Vision Engine (sidecar)
let pythonEngine: ChildProcess | null = null;
let _engineHeartbeatId: ReturnType<typeof setInterval> | null = null;

function startPythonEngine() {
    const enginePath = path.join(__dirname, "../engine/orbit_engine.py");
    log.info("Iniciando Python Vision Engine...");
    if (_engineHeartbeatId) {
        clearInterval(_engineHeartbeatId);
        _engineHeartbeatId = null;
    }
    try {
        pythonEngine = spawn("python", [enginePath], {
            stdio: ["ignore", "pipe", "pipe"],
            detached: false,
        });
        pythonEngine.stdout?.on("data", (d: Buffer) => {
            const line = d.toString().trim();
            if (line) log.debug(`[PyEngine] ${line}`);
        });
        pythonEngine.stderr?.on("data", (d: Buffer) => {
            const line = d.toString().trim();
            if (line) console.error(`[PyEngine] ${line}`);
        });
        pythonEngine.on("exit", (code) => {
            log.info(`Python engine terminado (codigo ${code}). Reintentando en 10s...`);
            pythonEngine = null;
            if (_engineHeartbeatId) {
                clearInterval(_engineHeartbeatId);
                _engineHeartbeatId = null;
            }
            setTimeout(startPythonEngine, 10000);
        });
        pythonEngine.on("error", (err) => {
            log.warn(`Python engine no se pudo iniciar: ${err.message}`);
            log.warn("Las funciones de vision YOLO no estaran disponibles.");
            pythonEngine = null;
        });
        _engineHeartbeatId = setInterval(async () => {
            try {
                const res = await fetch("http://localhost:18790/status");
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
            } catch {
                log.warn("PyEngine heartbeat fallo. Reiniciando engine...");
                if (pythonEngine) {
                    try { pythonEngine.kill(); } catch {}
                }
                pythonEngine = null;
                if (_engineHeartbeatId) {
                    clearInterval(_engineHeartbeatId);
                    _engineHeartbeatId = null;
                }
                setTimeout(startPythonEngine, 3000);
            }
        }, 30000);
    } catch (e: any) {
        log.warn(`Error al lanzar Python engine: ${e.message}`);
    }
}

// Speak (send text to Gemini Live)
function speak(text: string) {
    if (!geminiSession || !isGeminiReady) {
        log.warn("No puedo hablar: sesion Gemini no lista.");
        return;
    }
    try {
        geminiSession.sendClientContent({
            turns: [{ role: "user", parts: [{ text }] }],
            turnComplete: true
        });
    } catch (e: any) {
        log.warn("Error al enviar mensaje:", e.message);
    }
}

// Connect to Gemini Live API (via SDK)
async function connectGemini() {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey || apiKey === "TU_API_KEY_AQUI") {
        log.error("GEMINI_API_KEY no configurada. Edita .env o config/orbit.yaml");
        process.exit(1);
    }
    const ai = new GoogleGenAI({ apiKey });
    try {
        const mem = await loadMemory();
        const memStr = formatMemoryForPrompt(mem);
        const now = new Date().toLocaleString("es-MX", {
            weekday: "long", year: "numeric", month: "long",
            day: "numeric", hour: "2-digit", minute: "2-digit"
        });
        const systemPrompt = getSystemPrompt(memStr, now);
        geminiSession = await ai.live.connect({
            model: MODEL,
            config: {
                responseModalities: [Modality.AUDIO],
                speechConfig: {
                    voiceConfig: { prebuiltVoiceConfig: { voiceName: "Aoede" } }
                },
                systemInstruction: { parts: [{ text: systemPrompt }] },
                tools: [{ functionDeclarations: TOOL_DECLARATIONS as any[] }]
            },
            callbacks: {
                onopen: () => {
                    _geminiReconnectDelay = 2000;
                    isGeminiReady = true;
                    log.info("Sesion Gemini Live lista. Orbit esta en linea!");
                    broadcast({ type: "orbit_ready", message: "Orbit esta listo." });
                },
                onmessage: async (msg: any) => {
                    if (msg.serverContent) {
                        const sc = msg.serverContent;
                        if (sc.inputTranscription?.text?.trim()) {
                            _lastUserText = sc.inputTranscription.text.trim();
                            log.info(`[Usuario] ${_lastUserText}`);
                            addMessage(SESSION_ID, "user", _lastUserText);
                            broadcast({ type: "user_message", text: _lastUserText });
                            setTypingState("thinking");
                        }
                        if (sc.modelTurn?.parts) {
                            for (const part of sc.modelTurn.parts) {
                                if (part.text?.trim()) _lastOrbitText += part.text;
                            }
                        }
                        if (sc.outputTranscription?.text?.trim()) {
                            const orbitText = sc.outputTranscription.text.trim();
                            _lastOrbitText = orbitText;
                            log.info(`[Orbit] ${orbitText}`);
                            addMessage(SESSION_ID, "assistant", orbitText);
                            broadcast({ type: "orbit_message", text: orbitText });
                        }
                        if (sc.turnComplete) {
                            if (_lastOrbitText.trim()) {
                                broadcast({ type: "orbit_message", text: _lastOrbitText.trim() });
                                addMessage(SESSION_ID, "assistant", _lastOrbitText.trim());
                                _lastOrbitText = "";
                            }
                            broadcast({ type: "turn_complete" });
                            setTypingState("idle");
                            if (_lastUserText) {
                                maybeUpdateMemoryAsync(_lastUserText, _lastOrbitText).catch(() => {});
                            }
                        }
                    }
                    if (msg.toolCall?.functionCalls) {
                        const responses: any[] = [];
                        for (const call of msg.toolCall.functionCalls) {
                            log.info(`[Tool] ${call.name}`, call.args);
                            broadcast({ type: "tool_call", tool: call.name, args: call.args });
                            setTypingState("executing", call.name);
                            if (call.name === "agent_task") {
                                const goal = call.args?.goal || "";
                                const priority = call.args?.priority === "high"
                                    ? TaskPriority.HIGH
                                    : call.args?.priority === "low"
                                        ? TaskPriority.LOW
                                        : TaskPriority.NORMAL;
                                const taskId = getQueue().submit(goal, priority, speak);
                                responses.push({
                                    id: call.id,
                                    name: call.name,
                                    response: { result: `Tarea encolada (ID: ${taskId}). Te avisare cuando termine.` }
                                });
                            } else {
                                const result = await executeTool(call.name, call.args || {});
                                broadcast({ type: "tool_result", tool: call.name, result: result.slice(0, 300) });
                                responses.push({ id: call.id, name: call.name, response: { result } });
                            }
                        }
                        setTypingState("idle");
                        geminiSession.sendToolResponse({ functionResponses: responses });
                    }
                },
                onerror: (e: any) => {
                    log.error("Error sesion Gemini:", e?.message || e);
                },
                onclose: (e: any) => {
                    isGeminiReady = false;
                    geminiSession = null;
                    const code = e?.code ?? "?";
                    const reason = e?.reason ? ` - ${e.reason}` : "";
                    log.info(`Gemini desconectado (${code}${reason}). Reconectando en ${_geminiReconnectDelay / 1000}s...`);
                    broadcast({ type: "status", tasks: [] });
                    setTypingState("idle");
                    setTimeout(connectGemini, _geminiReconnectDelay);
                    _geminiReconnectDelay = Math.min(_geminiReconnectDelay * 2, GEMINI_MAX_RECONNECT_DELAY);
                }
            }
        });
    } catch (e: any) {
        log.error("Error al conectar con Gemini:", e.message);
        setTimeout(connectGemini, _geminiReconnectDelay);
        _geminiReconnectDelay = Math.min(_geminiReconnectDelay * 2, GEMINI_MAX_RECONNECT_DELAY);
    }
}

// Entry Point
async function main() {
    console.log(`
╔══════════════════════════════════════╗
║     ORBIT AI  -  Local Assistant   ║
║   Tu mejor amigo en la computadora   ║
╚══════════════════════════════════════╝
`);

    // Log startup info
    const available = providerRegistry.listAvailable();
    const activeProvider = providerRegistry.getActiveInfo();
    log.info(`Providers disponibles: ${available.join(", ") || "ninguno"}`);
    log.info(`Default: ${config.defaultProvider} (${activeProvider.name}) | Profile: ${config.toolProfile} | Tools: ${toolRegistry.count}`);

    // Load all plugins (Phase 3)
    await loadAllPlugins();
    log.info(`Plugins cargados: ${toolRegistry.count} tools disponibles.`);

    // Load all skills (Phase 5)
    await loadAllSkills();

    // Register built-in /commands (Phase 6)
    initAutoReply();

    // Phase 10: Memory auto-save every 5 minutes
    startMemoryAutoSave();

    startWebServer(config.server.webPort);
    startGateway(speak);
    startPythonEngine();
    await connectGemini();

    process.on("SIGINT", () => {
        log.info("Cerrando Orbit...");
        killPS();
        if (pythonEngine) pythonEngine.kill();
        process.exit(0);
    });

    process.on("SIGTERM", () => {
        killPS();
        if (pythonEngine) pythonEngine.kill();
        process.exit(0);
    });
}

main().catch((e) => {
    log.error("Error fatal al iniciar Orbit:", e);
    process.exit(1);
});

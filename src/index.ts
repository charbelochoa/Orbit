import { GoogleGenAI, Modality } from "@google/genai";
import { spawn, ChildProcess } from "child_process";
import path from "path";
import { fileURLToPath } from "url";

import { loadMemory, formatMemoryForPrompt, maybeUpdateMemoryAsync, startMemoryAutoSave } from "./memory/memory-manager.js";
import { addMessage, getHistory } from "./memory/chat-history.js";
import { startGateway, broadcast, setTypingState, updateTokenUsage, onElectronConnected, type ChatTurn } from "./gateway/server.js";
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
import { proactiveService } from "./proactive/service.js";
import { pruneOldEntries }  from "./memory/visual-memory.js";
import { ambientService }   from "./ambient/service.js";
import { ruleEngine }       from "./proactive/rule-engine.js";
import { notificationService, setElectronConnected } from "./notifications/service.js";
import { wakeWordMonitor }  from "./notifications/wake-word.js";
import { codebaseIndexer }  from "./codebase/indexer.js";
import { errorWatcher }     from "./codebase/error-watcher.js";
import { runHarnessTurn } from "./agent/text-harness.js";
import { runInLane } from "./agent/lanes.js";
import type { ChatMessage } from "./providers/types.js";

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

function announce(text: string) {
    broadcast({ type: "orbit_message", text });
}

async function chat({ text, sessionId, send, signal }: ChatTurn) {
    send({ type: "typing", state: "thinking" });
    try {
        const history = getHistory(sessionId, 24).flatMap<ChatMessage>(({ role, content }) =>
            role === "user" || role === "assistant" ? [{ role, content: content.slice(0, 8000) }] : [],
        );
        const memory = formatMemoryForPrompt(await loadMemory());
        const deadline = AbortSignal.any([signal, AbortSignal.timeout(180_000)]);
        const reply = await runHarnessTurn({
            systemPrompt: getSystemPrompt(memory.slice(0, 8000), new Date().toLocaleString("es-MX")),
            messages: [...history, { role: "user", content: text }],
            tools: toolRegistry.getByProfile(getConfig().toolProfile),
            maxIterations: getConfig().agent.maxChatSteps,
            signal: deadline,
            generate: params => providerRegistry.generateText({
                ...params,
                signal: AbortSignal.any([deadline, AbortSignal.timeout(45_000)]),
            }),
            execute: (name, args) => runInLane(sessionId, () => executeTool(name, args, deadline)),
            onTool: (name, result) => {
                if (result === undefined) {
                    send({ type: "tool_call", tool: name, args: {} });
                    send({ type: "typing", state: "executing", tool: name });
                } else {
                    send({ type: "tool_result", tool: name, result: result.slice(0, 1500) });
                    send({ type: "typing", state: "thinking" });
                }
            },
            onUsage: updateTokenUsage,
        });
        addMessage(sessionId, "user", text);
        addMessage(sessionId, "assistant", reply);
        send({ type: "orbit_message", text: reply });
    } catch (error) {
        if (signal.aborted) {
            send({ type: "orbit_message", text: "Turno cancelado." });
        } else {
            log.warn("Turno de texto fallido:", error instanceof Error ? error.message : String(error));
            send({ type: "orbit_message", text: "Orbit no pudo terminar el turno. Revisa el proveedor y el registro local." });
        }
    } finally {
        send({ type: "turn_complete" });
        send({ type: "typing", state: "idle" });
    }
}

// Connect to Gemini Live API (via SDK)
async function connectGemini() {
    const apiKey = getConfig().providers.gemini.apiKey;
    if (!apiKey || apiKey === "TU_API_KEY_AQUI") return;
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
                            // Sprint 12: Wake word detection
                            wakeWordMonitor.check(_lastUserText);
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
                        // Capture token usage when Gemini reports it
                        if (sc.usageMetadata) {
                            const u = sc.usageMetadata;
                            const inp = u.promptTokenCount       ?? u.inputTokenCount  ?? 0;
                            const out = u.candidatesTokenCount   ?? u.outputTokenCount ?? 0;
                            const ctx = u.totalTokenCount        ?? undefined;
                            if (inp > 0 || out > 0) {
                                updateTokenUsage(inp, out, ctx);
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
                                const taskId = getQueue().submit(goal, priority, announce);
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

    // Sprint 5: Proactive triggers (file watchers + cron schedules)
    await proactiveService.start();

    // Sprint 9: Ambient Awareness Engine
    await ambientService.start();

    // Sprint 11: Rule Engine (context-aware proactive triggers)
    const patternsCfg = config.patterns;
    if (patternsCfg?.enabled !== false) {
        ruleEngine.start(
            (patternsCfg?.ruleIntervalSec ?? 60) * 1000,
            patternsCfg?.disabledRules ?? [],
        );
    }

    // Sprint 12: Notifications + Wake Word
    if (config.notifications?.enabled !== false) {
        notificationService.start();
    }
    if (config.wakeWord?.enabled) {
        wakeWordMonitor.start();
    }

    // Sprint 13: Codebase Semantic Index + Error Watcher
    if (config.codebase?.enabled) {
        await codebaseIndexer.start();
    }
    if (config.codebase?.errorWatcher?.enabled) {
        errorWatcher.start();
    }

    // Sprint 6: Visual memory — prune old entries on startup
    pruneOldEntries();

    // Phase 10: Memory auto-save every 5 minutes
    startMemoryAutoSave();

    // Start gateway FIRST so it's ready when web UI connects
    startGateway(announce, chat);
    await startWebServer(config.server.webPort);
    // Sprint 12: when Electron connects, enable native toasts
    onElectronConnected((connected) => setElectronConnected(connected));
    startPythonEngine();
    await connectGemini();

    process.on("SIGINT", () => {
        log.info("Cerrando Orbit...");
        proactiveService.stop();
        ruleEngine.stop();
        notificationService.stop();
        wakeWordMonitor.stop();
        errorWatcher.stop();
        void codebaseIndexer.stop();
        ambientService.stop();
        killPS();
        if (pythonEngine) pythonEngine.kill();
        process.exit(0);
    });

    process.on("SIGTERM", () => {
        proactiveService.stop();
        ruleEngine.stop();
        notificationService.stop();
        wakeWordMonitor.stop();
        errorWatcher.stop();
        void codebaseIndexer.stop();
        ambientService.stop();
        killPS();
        if (pythonEngine) pythonEngine.kill();
        process.exit(0);
    });
}

main().catch((e) => {
    log.error("Error fatal al iniciar Orbit:", e);
    process.exit(1);
});

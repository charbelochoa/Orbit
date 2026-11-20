import { spawn, ChildProcess } from "child_process";
import path from "path";
import { fileURLToPath } from "url";

import { loadMemory, formatMemoryForPrompt, maybeUpdateMemoryAsync } from "./memory/memory-manager.js";
import { addMessage, getHistory } from "./memory/chat-history.js";
import { startGateway, broadcast, updateTokenUsage, onElectronConnected, type ChatTurn, type VoiceTurn } from "./gateway/server.js";
import { startWebServer } from "./ui/web-server.js";
import { toolRegistry } from "./core/registry.js";
import { getSystemPrompt } from "./core/prompt.js";
import { runVoiceTurn } from "./core/voice.js";
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
import { buildProjectContext } from "./context/project-facts.js";
import { skillRegistry } from "./skills/registry.js";
import { policyEngine } from "./core/tool-policy.js";
import { getQueue } from "./agent/task-queue.js";
import { fenceRecalledContext } from "./context/memory-fence.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const log = createLogger("Orbit");

// Load config early — merges orbit.yaml + .env
const config = loadConfig();
setLogLevel(config.logging.level);

// Python Vision Engine (sidecar)
let pythonEngine: ChildProcess | null = null;
let _engineHeartbeatId: ReturnType<typeof setInterval> | null = null;

function startPythonEngine() {
    const enginePath = path.join(process.env.ORBIT_ENGINE_DIR || path.join(__dirname, "../engine"), "orbit_engine.py");
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

async function chat({ text, sessionId, send, signal, provider }: ChatTurn) {
    send({ type: "typing", state: "thinking" });
    let success = false;
    try {
        const history = getHistory(sessionId, 24).flatMap<ChatMessage>(({ role, content }) =>
            role === "user" || role === "assistant" ? [{ role, content: content.slice(0, 8000) }] : [],
        );
        const [memoryState, project] = await Promise.all([loadMemory(), buildProjectContext()]);
        const memory = formatMemoryForPrompt(memoryState);
        const skills = skillRegistry.findRelevant(text, 3).map(skill => ({
            name: skill.metadata.name,
            instructions: skill.content.slice(0, 1000),
        }));
        const deadline = AbortSignal.any([signal, AbortSignal.timeout(180_000)]);
        const rawReply = await runHarnessTurn({
            systemPrompt: getSystemPrompt(memory.slice(0, 8000), new Date().toLocaleString("es-MX"), project) +
                "\n\nSkills para esta tarea\n" + JSON.stringify(skills),
            messages: [...history, { role: "user", content: text }],
            tools: policyEngine.filterTools(toolRegistry.getByProfile(getConfig().toolProfile)),
            maxIterations: getConfig().agent.maxChatSteps,
            signal: deadline,
            generate: params => providerRegistry.generateText(params, provider),
            execute: (name, args) => runInLane(sessionId, () => executeTool(name, args, deadline), deadline, name),
            onTool: (name, result, failed) => {
                if (result === undefined) {
                    send({ type: "tool_call", tool: name, args: {} });
                    send({ type: "typing", state: "executing", tool: name });
                } else {
                    send({ type: "tool_result", tool: name, error: failed, result: result.slice(0, 1500) });
                    send({ type: "typing", state: "thinking" });
                }
            },
            onUsage: updateTokenUsage,
        });
        const reply = fenceRecalledContext(rawReply) || "No pude componer la respuesta.";
        addMessage(sessionId, "user", text);
        addMessage(sessionId, "assistant", reply);
        send({ type: "orbit_message", text: reply });
        success = true;
        void maybeUpdateMemoryAsync(text).catch(() => {});
    } catch (error) {
        if (signal.aborted) {
            send({ type: "orbit_message", text: "Turno cancelado." });
        } else {
            log.warn("Turno de texto fallido:", error instanceof Error ? error.message : String(error));
            send({ type: "orbit_message", text: "Orbit no pudo terminar el turno. Revisa el proveedor y el registro local." });
        }
    } finally {
        send({ type: "turn_complete", success });
        send({ type: "typing", state: "idle" });
    }
}

async function voice({ data, sessionId, send, signal }: VoiceTurn) {
    send({ type: "typing", state: "thinking" });
    try {
        if (!getConfig().providers.gemini.apiKey) {
            send({ type: "error", message: "Configura GEMINI_API_KEY para usar el micrófono." });
            return;
        }
        const deadline = AbortSignal.any([signal, AbortSignal.timeout(120_000)]);
        const [memoryState, project] = await Promise.all([loadMemory(), buildProjectContext()]);
        const memory = formatMemoryForPrompt(memoryState);
        const conversation = getHistory(sessionId, 10)
            .map(message => message.role + ": " + message.content.slice(0, 1800)).join("\n");
        const systemPrompt = getSystemPrompt(memory.slice(0, 8000), new Date().toLocaleString("es-MX"), project);
        const result = await runVoiceTurn({
            data,
            systemPrompt: systemPrompt + "\n\nContexto previo de esta conversación\n" + conversation,
            signal: deadline,
            tools: toolRegistry.toGeminiDeclarations(getConfig().toolProfile),
            onAudio: (pcm, sampleRate) => send({ type: "voice_audio", pcm, sampleRate }),
            onUsage: updateTokenUsage,
            execute: async (name, args) => {
                send({ type: "tool_call", tool: name, args: {} });
                send({ type: "typing", state: "executing", tool: name });
                try {
                    const output = await runInLane(sessionId, () => executeTool(name, args, deadline), deadline, name);
                    send({ type: "tool_result", tool: name, result: output.slice(0, 1500) });
                    return output;
                } catch (error) {
                    deadline.throwIfAborted();
                    const output = error instanceof Error ? error.message : String(error);
                    send({ type: "tool_result", tool: name, error: true, result: output.slice(0, 1500) });
                    return "Error: " + output;
                }
            },
        });
        if (result.user) {
            addMessage(sessionId, "user", result.user);
            send({ type: "user_message", text: result.user });
            wakeWordMonitor.check(result.user);
        }
        const reply = fenceRecalledContext(result.assistant);
        if (reply) {
            addMessage(sessionId, "assistant", reply);
            send({ type: "orbit_message", text: reply });
            if (result.user) void maybeUpdateMemoryAsync(result.user).catch(() => {});
        }
    } catch {
        send({
            type: "error",
            message: signal.aborted ? "Turno de voz cancelado." : "Gemini Live no pudo completar el turno de voz.",
        });
    } finally {
        send({ type: "turn_complete" });
        send({ type: "typing", state: "idle" });
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

    // Start gateway FIRST so it's ready when web UI connects
    await startGateway(announce, chat, voice, config.server);
    await startWebServer(config.server.webPort, config.server.gatewayPort);
    getQueue().start();
    process.send?.({ type: "orbit-ready", ...config.server });
    // Sprint 12: when Electron connects, enable native toasts
    onElectronConnected((connected) => setElectronConnected(connected));
    if (process.env.ORBIT_VISION_ENGINE === "1") startPythonEngine();

    const stop = () => {
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
    };
    process.on("SIGINT", stop);
    process.on("SIGTERM", stop);
    if (process.connected) process.on("disconnect", stop);
    process.on("message", message => {
        if (message && typeof message === "object" && "type" in message && message.type === "orbit-stop") stop();
    });
}

main().catch((e) => {
    log.error("Error fatal al iniciar Orbit:", e);
    process.exit(1);
});

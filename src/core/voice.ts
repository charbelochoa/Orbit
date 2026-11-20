import {
    GoogleGenAI, Modality,
    type FunctionDeclaration, type FunctionResponse, type LiveServerMessage, type Session,
} from "@google/genai";
import { getConfig } from "../config/config.js";
import { IterationBudget } from "../agent/iteration-budget.js";
import { boundToolResult } from "../context/text-budget.js";
import { raceWithAbortSignal } from "../infra/race-abort.js";

interface VoiceOptions {
    data: string | AsyncIterable<string>;
    systemPrompt: string;
    tools: FunctionDeclaration[];
    signal: AbortSignal;
    onAudio: (data: string, sampleRate: number) => void;
    onUsage: (input: number, output: number) => void;
    execute: (name: string, args: Record<string, unknown>, signal: AbortSignal) => Promise<string>;
}

async function* voicePackets(data: VoiceOptions["data"]): AsyncGenerator<string> {
    if (typeof data !== "string") {
        yield* data;
        return;
    }
    const pcm = Buffer.from(data, "base64");
    for (let offset = 0; offset < pcm.length; offset += 6400) {
        yield pcm.subarray(offset, offset + 6400).toString("base64");
    }
}

export async function runVoiceTurn(options: VoiceOptions): Promise<{ user: string; assistant: string }> {
    const config = getConfig();
    const { apiKey, baseUrl, models } = config.providers.gemini;
    if (!apiKey) throw new Error("Añade GEMINI_API_KEY en la configuración para usar el micrófono.");
    const sessionAbort = new AbortController();
    const signal = AbortSignal.any([options.signal, sessionAbort.signal]);
    signal.throwIfAborted();

    const ai = new GoogleGenAI({ apiKey, httpOptions: baseUrl ? { baseUrl } : undefined });
    const budget = new IterationBudget(config.agent.maxChatSteps);
    const allowed = new Set(options.tools.map(tool => tool.name));
    let session: Session | undefined;
    let finished = false;
    let inputFinished = false;
    let pendingMessages = Promise.resolve();
    const cancelledCalls = new Set<string>();
    const activeCalls = new Map<string, AbortController>();
    const handledCalls = new Set<string>();
    let user = "";
    let assistant = "";
    let resolveTurn: () => void;
    let rejectTurn: (reason: unknown) => void;
    const turn = new Promise<void>((resolve, reject) => { resolveTurn = resolve; rejectTurn = reject; });
    let markReady: () => void;
    const ready = new Promise<void>(resolve => { markReady = resolve; });
    const abort = () => rejectTurn(signal.reason);
    signal.addEventListener("abort", abort, { once: true });

    const receive = async (message: LiveServerMessage) => {
        if (signal.aborted) return;
        const content = message.serverContent;
        if (content) {
            user += content.inputTranscription?.text || "";
            assistant += content.outputTranscription?.text || "";
            for (const part of content.modelTurn?.parts || []) {
                const audio = part.inlineData;
                if (audio?.data && audio.mimeType?.startsWith("audio/pcm")) {
                    const rate = Number(audio.mimeType.match(/rate=(\d+)/)?.[1]) || 24000;
                    options.onAudio(audio.data, rate);
                }
            }
        }
        if (message.usageMetadata) {
            const usage = message.usageMetadata;
            options.onUsage(usage.promptTokenCount ?? 0, usage.candidatesTokenCount ?? 0);
        }
        const calls = message.toolCall?.functionCalls;
        if (calls?.length) {
            const responses: FunctionResponse[] = [];
            for (const call of calls) {
                signal.throwIfAborted();
                if (!call.id) throw new Error("Gemini Live envió una llamada a herramienta sin identificador.");
                if (cancelledCalls.has(call.id) || handledCalls.has(call.id)) continue;
                handledCalls.add(call.id);
                const name = call.name ?? "";
                if (!allowed.has(name) || !budget.consume()) {
                    const result = allowed.has(name) ? "Se agotó el presupuesto de acciones." : "Herramienta no disponible.";
                    responses.push({ id: call.id, name, response: { result } });
                    continue;
                }
                const controller = new AbortController();
                const callSignal = AbortSignal.any([signal, controller.signal]);
                if (call.id) activeCalls.set(call.id, controller);
                let result: string;
                try {
                    result = await options.execute(name, call.args ?? {}, callSignal);
                    callSignal.throwIfAborted();
                } catch (error) {
                    if (controller.signal.aborted && !signal.aborted) continue;
                    throw error;
                } finally {
                    if (call.id) activeCalls.delete(call.id);
                }
                responses.push({ id: call.id, name, response: { result: boundToolResult(result) } });
            }
            signal.throwIfAborted();
            const pending = responses.filter(response => !response.id || !cancelledCalls.has(response.id));
            if (pending.length) session?.sendToolResponse({ functionResponses: pending });
        }
        if (content?.turnComplete && inputFinished) resolveTurn();
    };

    const connect = ai.live.connect({
        model: models.live || "gemini-3.8-live",
        config: {
            abortSignal: signal,
            responseModalities: [Modality.AUDIO],
            inputAudioTranscription: {},
            outputAudioTranscription: {},
            speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: config.voice.voiceName } } },
            realtimeInputConfig: { automaticActivityDetection: { disabled: true } },
            systemInstruction: options.systemPrompt,
            tools: options.tools.length ? [{ functionDeclarations: options.tools }] : undefined,
        },
        callbacks: {
            onmessage: message => {
                if (message.setupComplete) markReady();
                for (const id of message.toolCallCancellation?.ids ?? []) {
                    cancelledCalls.add(id);
                    activeCalls.get(id)?.abort();
                }
                pendingMessages = pendingMessages.then(() => receive(message));
                void pendingMessages.catch(rejectTurn);
            },
            onerror: () => rejectTurn(new Error("Gemini Live no pudo continuar la sesión de voz.")),
            onclose: () => rejectTurn(new Error("Gemini Live cerró la sesión de voz.")),
        },
    }).then(async connection => {
        if (finished || signal.aborted) {
            connection.close();
            throw signal.reason ?? new Error("La sesión de voz terminó.");
        }
        session = connection;
        await raceWithAbortSignal(ready, signal);
        let started = false;
        for await (const data of voicePackets(options.data)) {
            signal.throwIfAborted();
            if (!started) {
                connection.sendRealtimeInput({ activityStart: {} });
                started = true;
            }
            connection.sendRealtimeInput({ audio: { mimeType: "audio/pcm;rate=16000", data } });
        }
        signal.throwIfAborted();
        if (!started) throw new Error("Orbit no recibió muestras del micrófono.");
        inputFinished = true;
        connection.sendRealtimeInput({ activityEnd: {} });
        return turn;
    });

    try {
        await Promise.race([connect, turn]);
        return { user: user.trim(), assistant: assistant.trim() };
    } finally {
        finished = true;
        signal.removeEventListener("abort", abort);
        sessionAbort.abort();
        session?.close();
    }
}

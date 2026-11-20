import {
    GoogleGenAI, Modality,
    type FunctionDeclaration, type FunctionResponse, type LiveServerMessage, type Session,
} from "@google/genai";
import { getConfig } from "../config/config.js";
import { IterationBudget } from "../agent/iteration-budget.js";
import { boundToolResult } from "../context/text-budget.js";

interface VoiceOptions {
    data: string;
    systemPrompt: string;
    tools: FunctionDeclaration[];
    signal: AbortSignal;
    onAudio: (data: string, sampleRate: number) => void;
    onUsage: (input: number, output: number) => void;
    execute: (name: string, args: Record<string, unknown>) => Promise<string>;
}

export async function runVoiceTurn(options: VoiceOptions): Promise<{ user: string; assistant: string }> {
    const config = getConfig();
    const { apiKey, baseUrl, models } = config.providers.gemini;
    if (!apiKey) throw new Error("Añade GEMINI_API_KEY en la configuración para usar el micrófono.");
    const signal = options.signal;
    signal.throwIfAborted();

    const ai = new GoogleGenAI({ apiKey, httpOptions: baseUrl ? { baseUrl } : undefined });
    const budget = new IterationBudget(config.agent.maxChatSteps);
    const allowed = new Set(options.tools.map(tool => tool.name));
    let session: Session | undefined;
    let finished = false;
    let user = "";
    let assistant = "";
    let resolveTurn: () => void;
    let rejectTurn: (reason: unknown) => void;
    const turn = new Promise<void>((resolve, reject) => { resolveTurn = resolve; rejectTurn = reject; });
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
                if (!budget.consume()) throw new Error("Orbit alcanzó el límite de acciones de voz.");
                const name = call.name ?? "";
                const result = allowed.has(name)
                    ? await options.execute(name, call.args ?? {})
                    : "Herramienta no disponible.";
                responses.push({ id: call.id, name, response: { result: boundToolResult(result) } });
            }
            signal.throwIfAborted();
            session?.sendToolResponse({ functionResponses: responses });
        }
        if (content?.turnComplete) resolveTurn();
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
            onmessage: message => { void receive(message).catch(rejectTurn); },
            onerror: () => rejectTurn(new Error("Gemini Live no pudo continuar la sesión de voz.")),
            onclose: () => rejectTurn(new Error("Gemini Live cerró la sesión de voz.")),
        },
    }).then(connection => {
        if (finished || signal.aborted) {
            connection.close();
            throw signal.reason ?? new Error("La sesión de voz terminó.");
        }
        session = connection;
        session.sendRealtimeInput({ activityStart: {} });
        session.sendRealtimeInput({ audio: { mimeType: "audio/pcm;rate=16000", data: options.data } });
        session.sendRealtimeInput({ activityEnd: {} });
        return turn;
    });

    try {
        await Promise.race([connect, turn]);
        return { user: user.trim(), assistant: assistant.trim() };
    } finally {
        finished = true;
        signal.removeEventListener("abort", abort);
        session?.close();
    }
}

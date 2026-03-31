import WebSocket from "ws";
import { getSystemPrompt } from "./prompt.js";
import { TOOL_DECLARATIONS } from "./tool-registry.js";
import { executeTool } from "../actions/index.js";
import dotenv from "dotenv";

dotenv.config();

const MODEL = "models/gemini-2.0-flash-exp";
const HOST = "generativelanguage.googleapis.com";

export class GeminiLiveClient {
    private ws: WebSocket | null = null;
    private apiUrl: string;

    constructor() {
        const apiKey = process.env.GEMINI_API_KEY;
        if (!apiKey) {
            throw new Error("GEMINI_API_KEY no esta configurada en .env");
        }
        this.apiUrl = `wss://${HOST}/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContent?key=${apiKey}`;
    }

    public async connect(): Promise<void> {
        return new Promise((resolve, reject) => {
            console.log("[Orbit Voice] Iniciando conexion con Gemini Live API...");
            this.ws = new WebSocket(this.apiUrl);
            this.ws.on("open", () => {
                console.log("[Orbit Voice] Conectado.");
                this.setupSession();
                resolve();
            });
            this.ws.on("message", (data: WebSocket.RawData) => {
                this.handleMessage(data);
            });
            this.ws.on("close", (code) => {
                console.log(`[Orbit Voice] Desconectado (codigo ${code})`);
            });
            this.ws.on("error", (err) => {
                console.error("[Orbit Voice] Error en WebSocket:", err);
                reject(err);
            });
        });
    }

    private setupSession() {
        const now = new Date().toLocaleString("es-MX");
        const systemPrompt = getSystemPrompt("Sin datos guardados.", now);
        const setupMessage = {
            setup: {
                model: MODEL,
                generationConfig: {
                    responseModalities: ["AUDIO"],
                    speechConfig: {
                        voiceConfig: {
                            prebuiltVoiceConfig: { voiceName: "Aoede" }
                        }
                    }
                },
                systemInstruction: { parts: [{ text: systemPrompt }] },
                tools: [{ functionDeclarations: TOOL_DECLARATIONS }]
            }
        };
        this.send(setupMessage);
        console.log("[Orbit Voice] Sesion configurada.");
    }

    private handleMessage(data: WebSocket.RawData) {
        let msgStr = "";
        if (Buffer.isBuffer(data)) {
            msgStr = data.toString("utf-8");
        } else {
            msgStr = data.toString();
        }
        try {
            const parsed = JSON.parse(msgStr);
            if (parsed.serverContent) {
                const sc = parsed.serverContent;
                if (sc.modelTurn && sc.modelTurn.parts) {
                    sc.modelTurn.parts.forEach((part: any) => {
                        if (part.inlineData && part.inlineData.mimeType.startsWith("audio/")) {
                            // audio data available: part.inlineData.data (base64)
                        }
                    });
                }
                if (sc.interrupted) {
                    console.log("[Orbit Voice] Usuario interrumpio.");
                }
            }
            if (parsed.toolCall) {
                this.handleToolCalls(parsed.toolCall);
            }
        } catch (e: any) {
            console.error("[Orbit Voice] Error parseando mensaje del server:", e.message);
        }
    }

    private async handleToolCalls(toolCallPayload: any) {
        if (toolCallPayload.functionCalls) {
            const responses = [];
            for (const call of toolCallPayload.functionCalls) {
                console.log(`[Orbit Voice] TOOL CALL RECIBIDA: ${call.name}`);
                const resultString = await executeTool(call.name, call.args);
                responses.push({
                    id: call.id,
                    name: call.name,
                    response: { result: resultString }
                });
            }
            this.send({
                toolResponse: { functionResponses: responses }
            });
        }
    }

    public sendAudio(pcm16Base64: string) {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
        const msg = {
            realtimeInput: {
                mediaChunks: [{
                    mimeType: "audio/pcm;rate=16000",
                    data: pcm16Base64
                }]
            }
        };
        this.send(msg);
    }

    public sendText(text: string) {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
        const msg = {
            clientContent: {
                turns: [{ role: "user", parts: [{ text: text }] }],
                turnComplete: true
            }
        };
        this.send(msg);
    }

    private send(data: any) {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify(data));
        }
    }

    public disconnect() {
        if (this.ws) {
            this.ws.close();
            this.ws = null;
        }
    }
}

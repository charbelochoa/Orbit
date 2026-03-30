import WebSocket from "ws";
import { getSystemPrompt } from "./prompt.js";
import { TOOL_DECLARATIONS } from "./tool-registry.js";
import { executeTool } from "../actions/index.js";
import dotenv from "dotenv";

dotenv.config();

const MODEL = "models/gemini-2.0-flash-exp"; // Model supports Multimodal Live API
const HOST = "generativelanguage.googleapis.com";

export class GeminiLiveClient {
    private ws: WebSocket | null = null;
    private apiUrl: string;

    constructor() {
        const apiKey = process.env.GEMINI_API_KEY;
        if (!apiKey) {
            throw new Error("GEMINI_API_KEY no está configurada en .env");
        }
        // Correct endpoint for Gemini Live API over WebSockets
        this.apiUrl = `wss://${HOST}/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContent?key=${apiKey}`;
    }

    public async connect(): Promise<void> {
        return new Promise((resolve, reject) => {
            console.log("[Orbit Voice] Iniciando conexión con Gemini Live API...");
            
            this.ws = new WebSocket(this.apiUrl);
            
            this.ws.on("open", () => {
                console.log("[Orbit Voice] 🟢 Conectado.");
                this.setupSession();
                resolve();
            });

            this.ws.on("message", (data: WebSocket.RawData) => {
                this.handleMessage(data);
            });

            this.ws.on("close", (code) => {
                console.log(`[Orbit Voice] 🔴 Desconectado (código ${code})`);
            });

            this.ws.on("error", (err) => {
                console.error("[Orbit Voice] ❌ Error en WebSocket:", err);
                reject(err);
            });
        });
    }

    private setupSession() {
        // Enviar configuración inicial (system prompt, tools, voice settings)
        // Simulando context vacío y fecha actual
        const now = new Date().toLocaleString("es-MX");
        const systemPrompt = getSystemPrompt("Sin datos guardados.", now);

        const setupMessage = {
            setup: {
                model: MODEL,
                generationConfig: {
                    responseModalities: ["AUDIO"],
                    speechConfig: {
                        voiceConfig: {
                            prebuiltVoiceConfig: {
                                voiceName: "Aoede" // Voz femenina preconfigurada. (Puck, Aoede, Charon, Kore, Fenrir)
                            }
                        }
                    }
                },
                systemInstruction: {
                    parts: [{ text: systemPrompt }]
                },
                tools: [{ functionDeclarations: TOOL_DECLARATIONS }]
            }
        };

        this.send(setupMessage);
        
        // Indicamos que estamos listos para funcionar
        console.log("[Orbit Voice] ⚙️ Sesión configurada.");
    }

    private handleMessage(data: WebSocket.RawData) {
        let msgStr = "";
        if (Buffer.isBuffer(data)) {
            msgStr = data.toString('utf-8');
        } else {
            msgStr = data.toString();
        }

        try {
            const parsed = JSON.parse(msgStr);
            
            // Si es respuesta del modelo con audio o transcripción
            if (parsed.serverContent) {
                const sc = parsed.serverContent;
                
                // Procesar Audio
                if (sc.modelTurn && sc.modelTurn.parts) {
                    sc.modelTurn.parts.forEach((part: any) => {
                        if (part.inlineData && part.inlineData.mimeType.startsWith("audio/")) {
                            // En Node.js, aquí recibiríamos la data en Base64 para pasarla a los parlantes
                            // const audioPuff = Buffer.from(part.inlineData.data, 'base64');
                            // player.write(audioPuff);
                        }
                    });
                }
                
                // Procesar Transcripción Entrada/Salida
                if (sc.interrupted) {
                    console.log("[Orbit Voice] 🛑 Usuario interrumpió.");
                }
            }

            // Si el modelo solicita usar una herramienta (Function Call)
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
                 console.log(`[Orbit Voice] 🔧 TOOL CALL RECIBIDA: ${call.name}`);
                 
                 // Execute actual tools and get result
                 const resultString = await executeTool(call.name, call.args);
                 
                 responses.push({
                     id: call.id,
                     name: call.name,
                     response: {
                         result: resultString
                     }
                 });
             }
             
             // Enviar respuesta al modelo
             this.send({
                 toolResponse: {
                     functionResponses: responses
                 }
             });
         }
    }

    public sendAudio(pcm16Base64: string) {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
        
        // Enviar audio en vivo al modelo
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
                turns: [{
                    role: "user",
                    parts: [{ text: text }]
                }],
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

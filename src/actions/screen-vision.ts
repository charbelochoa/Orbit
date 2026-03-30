import screenshot from "screenshot-desktop";
import { GoogleGenAI } from "@google/genai";
import dotenv from "dotenv";
import os from "os";
import path from "path";
import fs from "fs/promises";

dotenv.config();

export async function screenVision(parameters: any): Promise<string> {
    const textPrompt = parameters?.text || "Describe lo que ves en esta pantalla.";
    const angle = parameters?.angle?.toLowerCase() || "screen";

    console.log(`[Screen Vision] 👁️ Analizando pantalla...`);

    try {
        if (angle !== "screen") {
            return "El modo de cámara (webcam) aún no está implementado en la versión de TypeScript.";
        }

        // 1. Tomar captura de pantalla temporal
        const tempPath = path.join(os.tmpdir(), `orbit_screen_${Date.now()}.png`);
        await screenshot({ filename: tempPath });

        // 2. Leer archivo a base64
        const imageBuffer = await fs.readFile(tempPath);
        const base64Image = imageBuffer.toString("base64");

        // 3. Inicializar GenAI SDK
        const apiKey = process.env.GEMINI_API_KEY;
        if (!apiKey) throw new Error("GEMINI_API_KEY no encontrada");
        
        const ai = new GoogleGenAI({ apiKey });

        // 4. Analizar con Gemini Flash (Multimodal)
        const response = await ai.models.generateContent({
            model: "gemini-2.5-flash",
            contents: [{
                role: "user",
                parts: [
                    {
                        inlineData: {
                            mimeType: "image/png",
                            data: base64Image
                        }
                    },
                    { text: textPrompt }
                ]
            }]
        });

        // Borrar el archivo temporal (Opcional, pero recomendado)
        try { await fs.unlink(tempPath); } catch (e) {}

        const analysis = response.text || "No obtuve una descripción válida.";
        console.log(`[Screen Vision] ✅ Análisis completado.`);
        
        return analysis;

    } catch (e: any) {
        console.error(`[Screen Vision] ❌ Error analizando pantalla:`, e);
        return `Screen vision falló: ${e.message}`;
    }
}

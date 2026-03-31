import screenshot from "screenshot-desktop";
import { GoogleGenAI } from "@google/genai";
import dotenv from "dotenv";
import os from "os";
import path from "path";
import fs from "fs/promises";

dotenv.config();

export async function screenVision(parameters: any): Promise<string> {
    const textPrompt = parameters?.text || "Describe lo que ves en esta pantalla.";
    const angle = (parameters?.angle || parameters?.source || "screen").toLowerCase();

    console.log(`[Screen Vision] Analizando ${angle}...`);
    try { let base64Image: string;
    let mimeType: string;
    if (angle === "camera" || angle === "webcam" || angle === "cam") { 
//  Webcam capture via Python engine
const response = await fetch("http://localhost:18790/camera");
    const data = await response.json() as { success: boolean;
    image_base64?: string;
    error?: string };
    if (!data.success || !data.image_base64) { return `No se pudo capturar la webcam: ${data.error || "sin respuesta del engine"}`;} base64Image = data.image_base64;
    mimeType = "image/jpeg"; } else { 
//  Screenshot
const tempPath = path.join(os.tmpdir(), `orbit_screen_${Date.now()}.png`);
    await screenshot({ filename: tempPath });
    const imageBuffer = await fs.readFile(tempPath);
    base64Image = imageBuffer.toString("base64");
    mimeType = "image/png";
    try { await fs.unlink(tempPath); } catch (e) {} } 
//  Analyze with Gemini Flash (Multimodal)
const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) throw new Error("GEMINI_API_KEY no encontrada");
    const ai = new GoogleGenAI({ apiKey });
    const response = await ai.models.generateContent({ model: "gemini-2.5-flash", contents: [{ role: "user", parts: [ { inlineData: { mimeType, data: base64Image } }, { text: textPrompt } ] }] });
    const analysis = response.text || "No obtuve una descripción válida.";
    console.log(`[Screen Vision] Análisis completado.`);
    return analysis; } catch (e: any) { console.error(`[Screen Vision] Error analizando ${angle}:`, e);
    return `Screen vision falló: ${e.message}`;
    }
}

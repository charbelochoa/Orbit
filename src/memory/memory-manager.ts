import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { GoogleGenAI } from "@google/genai";
import dotenv from "dotenv";

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MEMORY_PATH = path.join(__dirname, "../../data/memory/long_term.json");

// Intervalo de turnos antes de actualizar memoria (reduce llamadas API)
let _turnCounter = 0;
let _lastInput = "";
const MEMORY_EVERY_N_TURNS = 5;

interface MemoryStore {
    identity: Record<string, { value: string }>;
    preferences: Record<string, { value: string }>;
    relationships: Record<string, { value: string }>;
    notes: Record<string, { value: string }>;
}

function emptyMemory(): MemoryStore {
    return { identity: {}, preferences: {}, relationships: {}, notes: {} };
}

export async function loadMemory(): Promise<MemoryStore> {
    try {
        const raw = await fs.readFile(MEMORY_PATH, "utf-8");
        return JSON.parse(raw) as MemoryStore;
    } catch {
        return emptyMemory();
    }
}

async function saveMemory(mem: MemoryStore): Promise<void> {
    await fs.mkdir(path.dirname(MEMORY_PATH), { recursive: true });
    await fs.writeFile(MEMORY_PATH, JSON.stringify(mem, null, 2), "utf-8");
}

// Auto-save: persist memory to disk every 5 minutes (resilience)
let _autoSaveTimer: ReturnType<typeof setInterval> | null = null;
export function startMemoryAutoSave(): void {
    if (_autoSaveTimer) return;
    _autoSaveTimer = setInterval(async () => {
        try {
            const mem = await loadMemory();
            await saveMemory(mem);
            console.log("[Memory] Auto-save completado");
        } catch (e: any) {
            console.warn("[Memory] Auto-save falló:", e.message);
        }
    }, 5 * 60 * 1000);
    console.log("[Memory] Auto-save activado (cada 5 min)");
}

function mergeInto(target: any, updates: any): boolean {
    let changed = false;
    for (const [k, v] of Object.entries(updates)) {
        if (!v) continue;
        const entry = typeof v === "object" && (v as any).value !== undefined
            ? { value: String((v as any).value).slice(0, 300) }
            : { value: String(v).slice(0, 300) };
        if (JSON.stringify(target[k]) !== JSON.stringify(entry)) {
            target[k] = entry;
            changed = true;
        }
    }
    return changed;
}

export async function updateMemory(updates: Partial<MemoryStore>): Promise<void> {
    const mem = await loadMemory();
    let changed = false;
    for (const [section, data] of Object.entries(updates)) {
        if (data && typeof data === "object") {
            if (!mem[section as keyof MemoryStore]) (mem as any)[section] = {};
            if (mergeInto((mem as any)[section], data)) changed = true;
        }
    }
    if (changed) {
        await saveMemory(mem);
        console.log("[Memory] Memoria actualizada:", Object.keys(updates));
    }
}

export function formatMemoryForPrompt(mem: MemoryStore): string {
    const lines: string[] = [];
    const id = mem.identity;
    if (id?.name?.value) lines.push(`Nombre del usuario: ${id.name.value}`);
    if (id?.city?.value) lines.push(`Ciudad: ${id.city.value}`);
    if (id?.age?.value) lines.push(`Edad: ${id.age.value}`);
    for (const [k, v] of Object.entries(mem.preferences || {}).slice(0, 5)) {
        lines.push(`${k}: ${(v as any).value}`);
    }
    for (const [k, v] of Object.entries(mem.notes || {}).slice(0, 3)) {
        lines.push(`${k}: ${(v as any).value}`);
    }
    if (!lines.length) return "Sin datos guardados del usuario.";
    return "[MEMORIA DEL USUARIO]\n" + lines.map(l => `- ${l}`).join("\n");
}

export async function maybeUpdateMemoryAsync(userText: string, assistantText: string): Promise<void> {
    _turnCounter++;
    if (_turnCounter % MEMORY_EVERY_N_TURNS !== 0) return;
    if (userText.length < 10 || userText === _lastInput) return;
    _lastInput = userText;
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) return;
    try {
        const ai = new GoogleGenAI({ apiKey });
        const check = await ai.models.generateContent({
            model: "gemini-2.5-flash-lite",
            contents: [{ role: "user", parts: [{ text: `Does this message contain personal facts about the user (name, age, city, job, hobby, relationship, birthday, preference)? Reply ONLY YES or NO.\n\nMessage: ${userText.slice(0, 300)}` }] }]
        });
        if (!check.text?.toUpperCase().includes("YES")) return;
        const extract = await ai.models.generateContent({
            model: "gemini-2.5-flash-lite",
            contents: [{ role: "user", parts: [{ text: `Extract personal facts. Return ONLY valid JSON or {} if nothing:\n{"identity":{"name":{"value":"..."}},"preferences":{"hobby":{"value":"..."}},"notes":{"job":{"value":"..."}}}\n\nMessage: ${userText.slice(0, 500)}\n\nJSON:` }] }]
        });
        const raw = (extract.text || "{}").replace(/```(json)?/gi, "").trim();
        const data = JSON.parse(raw);
        if (Object.keys(data).length) await updateMemory(data);
    } catch (e: any) {
        if (!e.message?.includes("429")) console.warn("[Memory] ", e.message);
    }
}

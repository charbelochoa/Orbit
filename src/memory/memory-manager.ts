import fs from "fs/promises";
import fsSync from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { GoogleGenAI } from "@google/genai";
import dotenv from "dotenv";
import { createLogger } from "../infra/logger.js";
import { VectorMemoryStore, type MemorySearchResult } from "./vector-store.js";
import { expandQuery } from "./query-expansion.js";

dotenv.config();

const log = createLogger("memory");
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MEMORY_PATH = path.join(__dirname, "../../data/memory/long_term.json");
const MEMORY_MD_PATH = path.join(__dirname, "../../data/MEMORY.md");

// ── Vector store singleton ──────────────────────────────────────────────────
let _vectorStore: VectorMemoryStore | null = null;

function getVectorStore(): VectorMemoryStore {
    if (!_vectorStore) {
        _vectorStore = new VectorMemoryStore();
    }
    return _vectorStore;
}

export function closeVectorStore(): void {
    if (_vectorStore) {
        _vectorStore.close();
        _vectorStore = null;
    }
}

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
        if (!e.message?.includes("429")) log.warn(e.message);
    }
}

// ── Semantic Memory Search ──────────────────────────────────────────────────

/**
 * Search all indexed memory (MEMORY.md, long_term.json, past conversations)
 * using vector similarity or FTS5.
 */
export async function searchMemory(query: string, topK = 5): Promise<MemorySearchResult[]> {
    const store = getVectorStore();
    return store.search(query, topK);
}

/**
 * Index known memory files into the vector store.
 * Call this on startup and after memory changes.
 */
export async function indexMemoryFiles(): Promise<void> {
    const store = getVectorStore();
    const paths: string[] = [];

    // 1. MEMORY.md
    if (fsSync.existsSync(MEMORY_MD_PATH)) {
        paths.push(MEMORY_MD_PATH);
    }

    // 2. All .md files in data/memory/
    const memDir = path.dirname(MEMORY_PATH);
    if (fsSync.existsSync(memDir)) {
        const entries = fsSync.readdirSync(memDir);
        for (const entry of entries) {
            if (entry.endsWith(".md") || entry.endsWith(".txt")) {
                paths.push(path.join(memDir, entry));
            }
        }
    }

    // 3. Index long_term.json as text
    if (fsSync.existsSync(MEMORY_PATH)) {
        const raw = fsSync.readFileSync(MEMORY_PATH, "utf-8");
        const data = JSON.parse(raw);
        const text = flattenMemoryToText(data);
        if (text.length > 20) {
            await store.indexText("long_term_json", text);
        }
    }

    if (paths.length > 0) {
        await store.sync(paths);
    }

    const s = store.stats();
    log.info(`Memory indexed: ${s.files} files, ${s.chunks} chunks, ${s.embeddings} embeddings`);
}

/**
 * Index a chat turn into memory for future recall.
 */
export async function indexChatTurn(
    sessionId: string,
    userText: string,
    assistantText: string,
): Promise<void> {
    if (userText.length < 15) return; // skip trivial messages
    const store = getVectorStore();
    const content = `User: ${userText.slice(0, 1000)}\nAssistant: ${assistantText.slice(0, 1000)}`;
    await store.indexText(`chat:${sessionId}:${Date.now()}`, content);
}

/** Flatten long_term.json into a readable text for indexing. */
function flattenMemoryToText(mem: MemoryStore): string {
    const lines: string[] = [];
    for (const [section, data] of Object.entries(mem)) {
        if (!data || typeof data !== "object") continue;
        for (const [k, v] of Object.entries(data)) {
            const val = (v as any)?.value;
            if (val) lines.push(`${section}.${k}: ${val}`);
        }
    }
    return lines.join("\n");
}

/** Get memory stats from the vector store. */
export function memoryStats() {
    return getVectorStore().stats();
}

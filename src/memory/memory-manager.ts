import { APP_DATA } from "../config/paths.js";
import fs from "fs/promises";
import fsSync from "fs";
import path from "path";
import { generateText } from "../providers/registry.js";
import { withFileMutation, writeFileAtomically } from "../core/file-access.js";
import { z } from "zod";
import { createLogger } from "../infra/logger.js";
import { VectorMemoryStore, type MemorySearchResult } from "./vector-store.js";
import { expandQuery } from "./query-expansion.js";

const log = createLogger("memory");
const MEMORY_PATH = path.join(APP_DATA, "memory", "long_term.json");
const MEMORY_MD_PATH = path.join(APP_DATA, "MEMORY.md");

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
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return emptyMemory();
        return { ...emptyMemory(), ...parsed };
    } catch {
        return emptyMemory();
    }
}

async function saveMemory(mem: MemoryStore): Promise<void> {
    await fs.mkdir(path.dirname(MEMORY_PATH), { recursive: true });
    await writeFileAtomically(MEMORY_PATH, JSON.stringify(mem, null, 2));
}

const sections = ["identity", "preferences", "relationships", "notes"] as const;
export const memoryNoteKey = /^[\p{L}\p{N}_-]{1,48}$/u;
const memoryFields = z.record(z.string(), z.object({ value: z.string().trim().min(1).max(300) }));
const memoryUpdates = z.object({
    identity: memoryFields.optional(),
    preferences: memoryFields.optional(),
    relationships: memoryFields.optional(),
    notes: memoryFields.optional(),
});

export async function updateMemory(updates: Partial<MemoryStore>): Promise<void> {
    const validated = memoryUpdates.parse(updates);
    await withFileMutation([MEMORY_PATH], async () => {
        const memory = await loadMemory();
        let changed = false;
        for (const section of sections) {
            const current = memory[section] ||= {};
            const entries = Object.entries(validated[section] ?? {});
            for (const [key, entry] of entries) {
                if (!memoryNoteKey.test(key) || ["__proto__", "prototype", "constructor"].includes(key)) continue;
                if (current[key]?.value === entry.value) continue;
                current[key] = entry;
                changed = true;
            }
        }
        if (changed) await saveMemory(memory);
    });
}

export async function forgetMemoryNote(key: string): Promise<boolean> {
    return withFileMutation([MEMORY_PATH], async () => {
        const memory = await loadMemory();
        if (!memory.notes || !Object.hasOwn(memory.notes, key)) return false;
        delete memory.notes[key];
        await saveMemory(memory);
        return true;
    });
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

export async function maybeUpdateMemoryAsync(userText: string): Promise<void> {
    if (process.env.ORBIT_AUTO_MEMORY !== "1") return;
    _turnCounter++;
    if (_turnCounter % MEMORY_EVERY_N_TURNS !== 0 || userText.length < 10 || userText === _lastInput) return;
    _lastInput = userText;
    try {
        const response = await generateText({
            systemPrompt: [
                "Extract stable preferences the user stated about themselves. Return a JSON object or {}.",
                'Use {"preferences":{"key":{"value":"..."}}, "notes":{"key":{"value":"..."}}}.',
                "Exclude passwords, access tokens, private identifiers and temporary or inferred facts.",
            ].join(" "),
            messages: [{ role: "user", content: userText.slice(0, 1200) }],
            responseFormat: "json",
            maxTokens: 512,
            signal: AbortSignal.timeout(15_000),
        });
        const raw = response.text.trim().replace(/^\x60{3}(?:json)?\s*|\s*\x60{3}$/gi, "");
        const parsed = memoryUpdates.parse(JSON.parse(raw));
        if (parsed.preferences || parsed.notes) {
            await updateMemory({ preferences: parsed.preferences, notes: parsed.notes });
        }
    } catch {
        log.debug("No se actualizaron las preferencias del turno.");
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

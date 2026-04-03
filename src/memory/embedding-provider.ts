/**
 * Orbit Embedding Provider — Sprint 3
 * Abstraction for text embedding (vectorization) using multiple providers.
 *
 * Supports: Gemini, OpenAI, Ollama (local).
 * Each provider converts text → number[] (float vector).
 */

import { getConfig } from "../config/config.js";
import { createLogger } from "../infra/logger.js";

const log = createLogger("memory");

// ── Interface ────────────────────────────────────────────────────────────────

export interface EmbeddingProvider {
    readonly id:         string;
    readonly model:      string;
    readonly dimensions: number;

    /** Check if this provider has valid credentials */
    isAvailable(): boolean;

    /** Embed one or more texts into float vectors */
    embed(texts: string[]): Promise<number[][]>;
}

// ── Gemini Embeddings ────────────────────────────────────────────────────────

export class GeminiEmbeddingProvider implements EmbeddingProvider {
    readonly id = "gemini";
    readonly model = "text-embedding-004";
    readonly dimensions = 768;

    isAvailable(): boolean {
        return !!getConfig().providers.gemini.apiKey;
    }

    async embed(texts: string[]): Promise<number[][]> {
        const apiKey = getConfig().providers.gemini.apiKey;
        if (!apiKey) throw new Error("GEMINI_API_KEY not configured for embeddings");

        const results: number[][] = [];
        // Gemini embedding API: one request per text (batch not supported in basic API)
        for (const text of texts) {
            const res = await fetch(
                `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:embedContent?key=${apiKey}`,
                {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        model: `models/${this.model}`,
                        content: { parts: [{ text }] },
                    }),
                },
            );
            if (!res.ok) {
                const errText = await res.text();
                throw new Error(`Gemini embedding error ${res.status}: ${errText}`);
            }
            const data = await res.json() as { embedding?: { values?: number[] } };
            const values = data?.embedding?.values;
            if (!values || !Array.isArray(values)) {
                throw new Error("Gemini embedding response missing values");
            }
            results.push(values);
        }
        return results;
    }
}

// ── OpenAI Embeddings ────────────────────────────────────────────────────────

export class OpenAIEmbeddingProvider implements EmbeddingProvider {
    readonly id = "openai";
    readonly model = "text-embedding-3-small";
    readonly dimensions = 1536;

    isAvailable(): boolean {
        return !!getConfig().providers.openai.apiKey;
    }

    async embed(texts: string[]): Promise<number[][]> {
        const cfg = getConfig();
        const apiKey = cfg.providers.openai.apiKey;
        if (!apiKey) throw new Error("OPENAI_API_KEY not configured for embeddings");

        const baseUrl = cfg.providers.openai.baseUrl || "https://api.openai.com/v1";

        const res = await fetch(`${baseUrl}/embeddings`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${apiKey}`,
            },
            body: JSON.stringify({
                model: this.model,
                input: texts,
            }),
        });

        if (!res.ok) {
            const errText = await res.text();
            throw new Error(`OpenAI embedding error ${res.status}: ${errText}`);
        }

        const data = await res.json() as {
            data?: Array<{ embedding: number[]; index: number }>;
        };

        if (!data.data || !Array.isArray(data.data)) {
            throw new Error("OpenAI embedding response missing data");
        }

        // Sort by index to maintain order
        return data.data
            .sort((a, b) => a.index - b.index)
            .map(d => d.embedding);
    }
}

// ── Ollama Embeddings (local) ────────────────────────────────────────────────

export class OllamaEmbeddingProvider implements EmbeddingProvider {
    readonly id = "ollama";
    readonly model = "nomic-embed-text";
    readonly dimensions = 768;

    isAvailable(): boolean {
        return true; // Best-effort — Ollama must be running
    }

    async embed(texts: string[]): Promise<number[][]> {
        const cfg = getConfig();
        const baseUrl = cfg.providers.ollama.baseUrl || "http://localhost:11434";

        const results: number[][] = [];
        for (const text of texts) {
            const res = await fetch(`${baseUrl}/api/embeddings`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ model: this.model, prompt: text }),
            });

            if (!res.ok) {
                throw new Error(`Ollama embedding error ${res.status}`);
            }

            const data = await res.json() as { embedding?: number[] };
            if (!data.embedding) {
                throw new Error("Ollama embedding response missing embedding");
            }
            results.push(data.embedding);
        }
        return results;
    }
}

// ── Provider Resolution ──────────────────────────────────────────────────────

const providers: EmbeddingProvider[] = [
    new GeminiEmbeddingProvider(),
    new OpenAIEmbeddingProvider(),
    new OllamaEmbeddingProvider(),
];

/**
 * Get the best available embedding provider.
 * Priority: Gemini → OpenAI → Ollama
 */
export function getEmbeddingProvider(): EmbeddingProvider | null {
    for (const p of providers) {
        if (p.isAvailable()) {
            log.debug(`Embedding provider: ${p.id} (${p.model}, ${p.dimensions}d)`);
            return p;
        }
    }
    log.warn("No embedding provider available — vector search disabled");
    return null;
}

/**
 * Ollama Provider (Local LLM)
 * Phase 2.1 — Uses local Ollama HTTP API. No API key needed.
 */

import { getConfig } from "../config/config.js";
import type { LLMProvider, TextGenerationParams, TextGenerationResult } from "./types.js";

export class OllamaProvider implements LLMProvider {
    readonly id   = "ollama";
    readonly name = "Ollama (Local)";

    isAvailable(): boolean {
        // Ollama doesn't need an API key — availability is best-effort.
        // Will throw at runtime if Ollama server isn't running.
        return true;
    }

    async generateText(params: TextGenerationParams): Promise<TextGenerationResult> {
        const cfg = getConfig();
        const baseUrl = cfg.providers.ollama.baseUrl || "http://localhost:11434";
        const model = params.model || cfg.providers.ollama.models["default"] || "llama3";

        const messages: any[] = [];
        if (params.systemPrompt) {
            messages.push({ role: "system", content: params.systemPrompt });
        }
        for (const m of params.messages) {
            messages.push({ role: m.role, content: m.content });
        }

        const body: any = { model, messages, stream: false };
        if (params.temperature !== undefined) {
            body.options = { temperature: params.temperature };
        }

        const res = await fetch(`${baseUrl}/api/chat`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
        });

        if (!res.ok) {
            const err = await res.text();
            throw new Error(`Ollama error ${res.status}: ${err.slice(0, 200)}`);
        }

        const data: any = await res.json();
        return {
            text:     data.message?.content || "",
            provider: this.id,
            model,
        };
    }

    listModels(): string[] {
        return ["llama3", "llama3.1", "mistral", "codellama", "phi3", "qwen2"];
    }
}

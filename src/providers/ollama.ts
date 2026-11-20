/**
 * Ollama Provider (Local LLM)
 * Phase 2.1 — Uses local Ollama HTTP API. No API key needed.
 */

import { getConfig } from "../config/config.js";
import type { LLMProvider, TextGenerationParams, TextGenerationResult } from "./types.js";
import { ProviderHttpError } from "./retry.js";

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

        const body = {
            model, messages, stream: false,
            format: params.responseFormat === "json" ? "json" : undefined,
            options: { temperature: params.temperature, num_predict: params.maxTokens },
        };

        const res = await fetch(`${baseUrl}/api/chat`, {
            method: "POST",
            signal: params.signal,
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
        });

        if (!res.ok) {
            throw new ProviderHttpError("Ollama", res);
        }

        const data: any = await res.json();
        return {
            text:     data.message?.content || "",
            provider: this.id,
            model,
            usage: { inputTokens: data.prompt_eval_count ?? 0, outputTokens: data.eval_count ?? 0 },
        };
    }

    listModels(): string[] {
        return ["llama3", "llama3.1", "mistral", "codellama", "phi3", "qwen2"];
    }
}

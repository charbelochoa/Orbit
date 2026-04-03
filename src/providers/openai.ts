/**
 * OpenAI Provider
 * Phase 2.1 — Uses raw fetch() (no SDK dependency required).
 */

import { getConfig } from "../config/config.js";
import type { LLMProvider, TextGenerationParams, TextGenerationResult } from "./types.js";

export class OpenAIProvider implements LLMProvider {
    readonly id   = "openai";
    readonly name = "OpenAI";

    isAvailable(): boolean {
        return !!getConfig().providers.openai.apiKey;
    }

    async generateText(params: TextGenerationParams): Promise<TextGenerationResult> {
        const cfg = getConfig();
        const apiKey = cfg.providers.openai.apiKey;
        if (!apiKey) throw new Error("OPENAI_API_KEY not configured");

        const baseUrl = cfg.providers.openai.baseUrl || "https://api.openai.com/v1";
        const model = params.model || cfg.providers.openai.models["default"] || "gpt-4o-mini";

        const messages: any[] = [];
        if (params.systemPrompt) {
            messages.push({ role: "system", content: params.systemPrompt });
        }
        for (const m of params.messages) {
            messages.push({ role: m.role, content: m.content });
        }

        const body: any = { model, messages };
        if (params.temperature !== undefined) body.temperature = params.temperature;
        if (params.maxTokens) body.max_tokens = params.maxTokens;
        if (params.responseFormat === "json") body.response_format = { type: "json_object" };

        const res = await fetch(`${baseUrl}/chat/completions`, {
            method: "POST",
            headers: {
                "Content-Type":  "application/json",
                "Authorization": `Bearer ${apiKey}`,
            },
            body: JSON.stringify(body),
        });

        if (!res.ok) {
            const status = res.status;
            // Security: never include raw API response in errors (may contain keys/secrets)
            throw new Error(`OpenAI API error ${status}`);
        }

        const data: any = await res.json();
        return {
            text: data.choices?.[0]?.message?.content || "",
            usage: data.usage ? {
                inputTokens:  data.usage.prompt_tokens,
                outputTokens: data.usage.completion_tokens,
            } : undefined,
            provider: this.id,
            model,
        };
    }

    listModels(): string[] {
        return ["gpt-4o", "gpt-4o-mini", "gpt-4-turbo", "o1", "o1-mini", "o3-mini"];
    }
}

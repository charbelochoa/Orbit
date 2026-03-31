/**
 * Anthropic Provider
 * Phase 2.1 — Uses raw fetch() (no SDK dependency required).
 */

import { getConfig } from "../config/config.js";
import type { LLMProvider, TextGenerationParams, TextGenerationResult } from "./types.js";

export class AnthropicProvider implements LLMProvider {
    readonly id   = "anthropic";
    readonly name = "Anthropic";

    isAvailable(): boolean {
        return !!getConfig().providers.anthropic.apiKey;
    }

    async generateText(params: TextGenerationParams): Promise<TextGenerationResult> {
        const cfg = getConfig();
        const apiKey = cfg.providers.anthropic.apiKey;
        if (!apiKey) throw new Error("ANTHROPIC_API_KEY not configured");

        const model = params.model || cfg.providers.anthropic.models["default"] || "claude-sonnet-4-20250514";

        const messages: any[] = params.messages
            .filter(m => m.role !== "system")
            .map(m => ({ role: m.role, content: m.content }));

        const body: any = {
            model,
            messages,
            max_tokens: params.maxTokens || 4096,
        };
        if (params.systemPrompt) body.system = params.systemPrompt;
        if (params.temperature !== undefined) body.temperature = params.temperature;

        const res = await fetch("https://api.anthropic.com/v1/messages", {
            method: "POST",
            headers: {
                "Content-Type":     "application/json",
                "x-api-key":        apiKey,
                "anthropic-version": "2023-06-01",
            },
            body: JSON.stringify(body),
        });

        if (!res.ok) {
            const err = await res.text();
            throw new Error(`Anthropic API error ${res.status}: ${err.slice(0, 200)}`);
        }

        const data: any = await res.json();
        return {
            text: data.content?.[0]?.text || "",
            usage: data.usage ? {
                inputTokens:  data.usage.input_tokens,
                outputTokens: data.usage.output_tokens,
            } : undefined,
            provider: this.id,
            model,
        };
    }

    listModels(): string[] {
        return ["claude-sonnet-4-20250514", "claude-opus-4-20250514", "claude-3-haiku-20240307"];
    }
}

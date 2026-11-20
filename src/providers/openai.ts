/**
 * OpenAI Provider
 * Phase 2.1 — Uses raw fetch() (no SDK dependency required).
 */

import { getConfig } from "../config/config.js";
import type { LLMProvider, TextGenerationParams, TextGenerationResult } from "./types.js";
import { ProviderHttpError } from "./retry.js";
import { parseToolArguments, readFunctionCalls, toOpenAITools } from "./tool-adapter.js";

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
        if (params.image) {
            const message = messages.at(-1);
            message.content = [
                { type: "text", text: message.content },
                { type: "image_url", image_url: { url: `data:${params.image.mimeType};base64,${params.image.data}` } },
            ];
        }

        const toolContext = params.toolContext;
        for (const exchange of toolContext?.exchanges ?? []) {
            messages.push({
                role: "assistant",
                content: exchange.text || null,
                tool_calls: exchange.outcomes.map(({ call }) => ({
                    id: call.id,
                    type: "function",
                    function: { name: call.name, arguments: JSON.stringify(parseToolArguments(call.arguments) ?? {}) },
                })),
            });
            for (const { call, output } of exchange.outcomes) {
                messages.push({ role: "tool", tool_call_id: call.id, content: output });
            }
        }

        const body: any = { model, messages };
        if (toolContext?.tools.length) {
            body.tools = toOpenAITools(toolContext.tools);
            body.tool_choice = toolContext.allowCalls ? "auto" : "none";
        }
        if (params.temperature !== undefined) body.temperature = params.temperature;
        if (params.maxTokens) body.max_tokens = params.maxTokens;
        if (params.responseFormat === "json") body.response_format = { type: "json_object" };

        const res = await fetch(`${baseUrl}/chat/completions`, {
            method: "POST",
            signal: params.signal,
            headers: {
                "Content-Type":  "application/json",
                "Authorization": `Bearer ${apiKey}`,
            },
            body: JSON.stringify(body),
        });

        if (!res.ok) {
            throw new ProviderHttpError("OpenAI", res);
        }

        const data: any = await res.json();
        const message = data.choices?.[0]?.message;
        return {
            text: message?.content || "",
            calls: toolContext ? readFunctionCalls(message?.tool_calls) : undefined,
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

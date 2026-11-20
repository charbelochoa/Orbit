/**
 * Anthropic Provider
 * Phase 2.1 — Uses raw fetch() (no SDK dependency required).
 */

import { getConfig } from "../config/config.js";
import type { LLMProvider, ProviderToolCall, TextGenerationParams, TextGenerationResult } from "./types.js";
import { ProviderHttpError } from "./retry.js";
import { parseToolArguments, toAnthropicTools } from "./tool-adapter.js";

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
        if (params.image) {
            const message = messages.at(-1);
            message.content = [
                { type: "image", source: { type: "base64", media_type: params.image.mimeType, data: params.image.data } },
                { type: "text", text: message.content },
            ];
        }

        const toolContext = params.toolContext;
        for (const exchange of toolContext?.exchanges ?? []) {
            const toolUses = exchange.outcomes.map(({ call }) => ({
                type: "tool_use",
                id: call.id,
                name: call.name,
                input: parseToolArguments(call.arguments) ?? {},
            }));
            const original = exchange.provider === this.id && exchange.model === model && Array.isArray(exchange.nativeAssistant)
                ? exchange.nativeAssistant
                : undefined;
            let index = 0;
            const blocks = original?.map(block => block.type === "tool_use" ? toolUses[index++] : block);
            messages.push({
                role: "assistant",
                content: blocks && index === toolUses.length && blocks.every(Boolean)
                    ? blocks
                    : [...(exchange.text ? [{ type: "text", text: exchange.text }] : []), ...toolUses],
            }, {
                role: "user",
                content: exchange.outcomes.map(({ call, output, failed }) => ({
                    type: "tool_result",
                    tool_use_id: call.id,
                    content: output,
                    is_error: failed,
                })),
            });
        }

        const body: any = {
            model,
            messages,
            max_tokens: params.maxTokens || 4096,
        };
        if (params.systemPrompt) body.system = params.systemPrompt;
        if (params.temperature !== undefined) body.temperature = params.temperature;
        if (toolContext?.tools.length) {
            body.tools = toAnthropicTools(toolContext.tools);
            body.tool_choice = { type: toolContext.allowCalls ? "auto" : "none" };
        }

        const baseUrl = cfg.providers.anthropic.baseUrl || "https://api.anthropic.com/v1";
        const res = await fetch(`${baseUrl}/messages`, {
            method: "POST",
            signal: params.signal,
            headers: {
                "Content-Type":     "application/json",
                "x-api-key":        apiKey,
                "anthropic-version": "2023-06-01",
            },
            body: JSON.stringify(body),
        });

        if (!res.ok) {
            throw new ProviderHttpError("Anthropic", res);
        }

        const data: any = await res.json();
        const blocks: Array<{ type: string; id?: string; name?: string; text?: string; input?: unknown }> =
            Array.isArray(data.content) ? data.content : [];
        const calls: ProviderToolCall[] = blocks.flatMap(block =>
            block.type === "tool_use" && typeof block.name === "string"
                ? [{ id: block.id, name: block.name, arguments: block.input }]
                : []);
        return {
            text: blocks.filter(block => block.type === "text").map(block => block.text ?? "").join(""),
            calls: toolContext ? calls : undefined,
            nativeAssistant: toolContext ? blocks : undefined,
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

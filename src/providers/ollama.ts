/**
 * Ollama Provider (Local LLM)
 * Phase 2.1 — Uses local Ollama HTTP API. No API key needed.
 */

import { getConfig } from "../config/config.js";
import type { LLMProvider, TextGenerationParams, TextGenerationResult } from "./types.js";
import { ProviderHttpError } from "./retry.js";
import { parseToolArguments, readFunctionCalls, toOpenAITools } from "./tool-adapter.js";

export class OllamaProvider implements LLMProvider {
    readonly id   = "ollama";
    readonly name = "Ollama (Local)";

    isAvailable(): boolean {
        // Ollama doesn't need an API key — availability is best-effort.
        // Will throw at runtime if Ollama server isn't running.
        return true;
    }

    defaultTextModel(): string {
        return getConfig().providers.ollama.models.default || "llama3";
    }

    async generateText(params: TextGenerationParams): Promise<TextGenerationResult> {
        const cfg = getConfig();
        const baseUrl = cfg.providers.ollama.baseUrl || "http://localhost:11434";
        const model = params.model || this.defaultTextModel();

        const messages: any[] = [];
        if (params.systemPrompt) {
            messages.push({ role: "system", content: params.systemPrompt });
        }
        for (const m of params.messages) {
            messages.push({ role: m.role, content: m.content });
        }
        if (params.image) messages.at(-1).images = [params.image.data];

        const toolContext = params.toolContext;
        for (const exchange of toolContext?.exchanges ?? []) {
            messages.push({
                role: "assistant",
                content: exchange.text,
                tool_calls: exchange.outcomes.map(({ call }, index) => ({
                    type: "function",
                    function: { index, name: call.name, arguments: parseToolArguments(call.arguments) ?? {} },
                })),
            });
            for (const { call, output } of exchange.outcomes) {
                messages.push({ role: "tool", tool_name: call.name, content: output });
            }
        }

        const body = {
            model, messages, stream: false,
            tools: toolContext?.allowCalls ? toOpenAITools(toolContext.tools) : undefined,
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
            calls: toolContext ? readFunctionCalls(data.message?.tool_calls) : undefined,
            provider: this.id,
            model,
            usage: { inputTokens: data.prompt_eval_count ?? 0, outputTokens: data.eval_count ?? 0 },
        };
    }

    listModels(): string[] {
        return ["llama3", "llama3.1", "mistral", "codellama", "phi3", "qwen2"];
    }
}

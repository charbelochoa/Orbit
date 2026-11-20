/**
 * Gemini Provider
 * Phase 2.1 — Wraps @google/genai for text generation.
 * Note: Gemini Live (audio) stays in index.ts — this is for text-only calls.
 */

import { FunctionCallingConfigMode, GoogleGenAI, type Content } from "@google/genai";
import { getConfig } from "../config/config.js";
import type { LLMProvider, TextGenerationParams, TextGenerationResult } from "./types.js";
import { toGeminiTools } from "./tool-adapter.js";

export class GeminiProvider implements LLMProvider {
    readonly id   = "gemini";
    readonly name = "Google Gemini";
    private ai: GoogleGenAI | null = null;
    private previousKey = "";
    private previousUrl = "";

    private getClient(): GoogleGenAI {
        const { apiKey, baseUrl } = getConfig().providers.gemini;
        if (!apiKey) throw new Error("GEMINI_API_KEY not configured");
        if (!this.ai || this.previousKey !== apiKey || this.previousUrl !== baseUrl) {
            this.ai = new GoogleGenAI({ apiKey, httpOptions: baseUrl ? { baseUrl } : undefined });
            this.previousKey = apiKey;
            this.previousUrl = baseUrl;
        }
        return this.ai;
    }

    isAvailable(): boolean {
        return !!getConfig().providers.gemini.apiKey;
    }

    async generateText(params: TextGenerationParams): Promise<TextGenerationResult> {
        const ai = this.getClient();
        const cfg = getConfig();
        const model = params.model || cfg.providers.gemini.models["fast"] || "gemini-2.5-flash-lite";

        const contents: Content[] = params.messages
            .filter(m => m.role !== "system")
            .map(m => ({
                role: m.role === "assistant" ? "model" : "user",
                parts: [{ text: m.content }],
            }));
        if (params.image) contents.at(-1)?.parts?.unshift({ inlineData: params.image });

        const toolContext = params.toolContext;
        for (const exchange of toolContext?.exchanges ?? []) {
            const original = exchange.provider === this.id && exchange.model === model
                ? exchange.nativeAssistant as Content | undefined
                : undefined;
            const calls = original?.parts?.flatMap(part => part.functionCall ? [part.functionCall] : []);
            if (original && calls && calls.length === exchange.outcomes.length &&
                calls.every((call, index) => call.name === exchange.outcomes[index].call.name &&
                    (!call.id || call.id === exchange.outcomes[index].call.id))) {
                contents.push(original, {
                    role: "user",
                    parts: exchange.outcomes.map(({ output, failed }, index) => ({
                        functionResponse: {
                            id: calls[index].id,
                            name: calls[index].name,
                            response: { output, failed },
                        },
                    })),
                });
            } else {
                contents.push({
                    role: "user",
                    parts: [{ text: JSON.stringify({
                        priorToolResults: exchange.outcomes.map(({ call, output, failed }) => ({ name: call.name, output, failed })),
                    }) }],
                });
            }
        }

        const response = await ai.models.generateContent({
            model,
            contents,
            config: {
                abortSignal: params.signal,
                ...(params.systemPrompt
                    ? { systemInstruction: { parts: [{ text: params.systemPrompt }] } }
                    : {}),
                ...(params.temperature !== undefined ? { temperature: params.temperature } : {}),
                ...(params.maxTokens ? { maxOutputTokens: params.maxTokens } : {}),
                ...(params.responseFormat === "json" ? { responseMimeType: "application/json" } : {}),
                ...(toolContext?.tools.length ? {
                    tools: [{ functionDeclarations: toGeminiTools(toolContext.tools) }],
                    toolConfig: {
                        functionCallingConfig: {
                            mode: toolContext.allowCalls ? FunctionCallingConfigMode.AUTO : FunctionCallingConfigMode.NONE,
                        },
                    },
                } : {}),
            },
        });

        const usage = response.usageMetadata;
        return {
            text:     response.text || "",
            provider: this.id,
            model,
            calls: toolContext ? (response.functionCalls ?? []).map(call => ({
                id: call.id, name: call.name ?? "unknown_tool", arguments: call.args ?? {},
            })) : undefined,
            nativeAssistant: toolContext ? response.candidates?.[0]?.content : undefined,
            usage: usage ? {
                inputTokens:  usage.promptTokenCount ?? 0,
                outputTokens: usage.candidatesTokenCount ?? 0,
            } : undefined,
        };
    }

    listModels(): string[] {
        return [
            "gemini-2.5-flash-lite",
            "gemini-2.5-flash",
            "gemini-2.5-flash-native-audio-latest",
            "gemini-2.5-pro",
        ];
    }
}

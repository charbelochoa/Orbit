/**
 * Gemini Provider
 * Phase 2.1 — Wraps @google/genai for text generation.
 * Note: Gemini Live (audio) stays in index.ts — this is for text-only calls.
 */

import { GoogleGenAI } from "@google/genai";
import { getConfig } from "../config/config.js";
import type { LLMProvider, TextGenerationParams, TextGenerationResult } from "./types.js";

export class GeminiProvider implements LLMProvider {
    readonly id   = "gemini";
    readonly name = "Google Gemini";
    private ai: GoogleGenAI | null = null;

    private getClient(): GoogleGenAI {
        if (!this.ai) {
            const apiKey = getConfig().providers.gemini.apiKey;
            if (!apiKey) throw new Error("GEMINI_API_KEY not configured");
            this.ai = new GoogleGenAI({ apiKey });
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

        const contents = params.messages
            .filter(m => m.role !== "system")
            .map(m => ({
                role: m.role === "assistant" ? "model" : "user",
                parts: [{ text: m.content }],
            }));

        const response = await ai.models.generateContent({
            model,
            contents,
            config: {
                ...(params.systemPrompt
                    ? { systemInstruction: { parts: [{ text: params.systemPrompt }] } }
                    : {}),
                ...(params.temperature !== undefined ? { temperature: params.temperature } : {}),
                ...(params.maxTokens ? { maxOutputTokens: params.maxTokens } : {}),
                ...(params.responseFormat === "json" ? { responseMimeType: "application/json" } : {}),
            },
        });

        return {
            text:     response.text || "",
            provider: this.id,
            model,
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

/**
 * Orbit LLM Provider Types
 * Phase 2.1 — Common interfaces for multi-provider LLM support.
 */

import type { OrbitTool } from "../core/registry.js";

// ── Text Generation ──────────────────────────────────────────────────────────

export interface TextGenerationParams {
    model?:         string;
    systemPrompt?:  string;
    messages:       ChatMessage[];
    temperature?:   number;
    maxTokens?:     number;
    responseFormat?: "text" | "json";
    signal?: AbortSignal;
    image?: ImageAttachment;
    toolContext?: {
        tools: OrbitTool[];
        exchanges: ToolExchange[];
        allowCalls: boolean;
    };
}

export interface ImageAttachment {
    mimeType: "image/png" | "image/jpeg";
    data: string;
}

export interface ChatMessage {
    role:    "user" | "assistant" | "system";
    content: string;
}

export interface TextGenerationResult {
    text:     string;
    usage?:   TokenUsage;
    provider: string;
    model:    string;
    calls?: ProviderToolCall[];
    nativeAssistant?: unknown;
}

export interface ProviderToolCall {
    id?: string;
    name: string;
    arguments: unknown;
}

export interface ToolOutcome {
    call: ProviderToolCall & { id: string };
    output: string;
    failed: boolean;
}

export interface ToolExchange {
    provider: string;
    model: string;
    text: string;
    outcomes: ToolOutcome[];
    nativeAssistant?: unknown;
}

export interface TokenUsage {
    inputTokens:  number;
    outputTokens: number;
}

// ── Provider Interface ───────────────────────────────────────────────────────

export interface LLMProvider {
    readonly id:   string;
    readonly name: string;

    /** Check if this provider has valid credentials / is reachable */
    isAvailable(): boolean;

    /** Generate text completion */
    generateText(params: TextGenerationParams): Promise<TextGenerationResult>;

    /** List known model IDs for this provider */
    listModels(): string[];
}

// ── Model Capabilities (for future use) ──────────────────────────────────────

export interface ModelCapabilities {
    contextWindow:  number;
    supportsTools:  boolean;
    supportsVision: boolean;
    supportsAudio:  boolean;
}

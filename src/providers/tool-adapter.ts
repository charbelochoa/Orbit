/**
 * Orbit Tool Schema Adapter
 * Phase 2.3 — Converts OrbitTool definitions between provider formats.
 */

import type { OrbitTool } from "../core/registry.js";

// ── Gemini Format ────────────────────────────────────────────────────────────

/** Convert to Gemini functionDeclarations (native format, no conversion needed) */
export function toGeminiTools(tools: OrbitTool[]): any[] {
    return tools.map(t => ({
        name: t.id,
        description: t.description,
        parameters: t.parameters,
    }));
}

// ── OpenAI Format ────────────────────────────────────────────────────────────

/** Convert to OpenAI tools format */
export function toOpenAITools(tools: OrbitTool[]): any[] {
    return tools.map(t => ({
        type: "function",
        function: {
            name: t.id,
            description: t.description,
            parameters: geminiToJsonSchema(t.parameters),
        },
    }));
}

// ── Anthropic Format ─────────────────────────────────────────────────────────

/** Convert to Anthropic tools format */
export function toAnthropicTools(tools: OrbitTool[]): any[] {
    return tools.map(t => ({
        name: t.id,
        description: t.description,
        input_schema: geminiToJsonSchema(t.parameters),
    }));
}

// ── Ollama Format (OpenAI-compatible) ────────────────────────────────────────

/** Convert to Ollama tools format (same as OpenAI) */
export function toOllamaTools(tools: OrbitTool[]): any[] {
    return toOpenAITools(tools);
}

// ── Internal Helpers ─────────────────────────────────────────────────────────

/**
 * Convert Gemini parameter schema to JSON Schema.
 *
 * Gemini format:
 *   { type: "OBJECT", properties: { name: { type: "STRING", description: "..." } }, required: ["name"] }
 *
 * JSON Schema:
 *   { type: "object", properties: { name: { type: "string", description: "..." } }, required: ["name"] }
 */
function geminiToJsonSchema(params: Record<string, any>): Record<string, any> {
    if (!params) return { type: "object", properties: {} };

    const properties: Record<string, any> = {};

    for (const [key, prop] of Object.entries(params.properties || {})) {
        const p = prop as any;
        const schema: any = {
            type: geminiTypeToJsonType(p.type),
        };
        if (p.description) schema.description = p.description;
        if (p.enum) schema.enum = p.enum;
        if (p.items) schema.items = geminiToJsonSchema(p.items);
        properties[key] = schema;
    }

    return {
        type: "object",
        properties,
        required: params.required || [],
    };
}

function geminiTypeToJsonType(geminiType: string): string {
    switch (geminiType?.toUpperCase()) {
        case "STRING":  return "string";
        case "INTEGER": return "integer";
        case "NUMBER":  return "number";
        case "BOOLEAN": return "boolean";
        case "ARRAY":   return "array";
        case "OBJECT":  return "object";
        default:        return "string";
    }
}

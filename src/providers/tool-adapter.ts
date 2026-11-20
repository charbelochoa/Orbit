import { createHash } from "node:crypto";
import type { FunctionDeclaration } from "@google/genai";
import type { OrbitTool } from "../core/registry.js";
import type { ProviderToolCall, ToolExchange } from "./types.js";

export function toGeminiTools(tools: OrbitTool[]): FunctionDeclaration[] {
    return tools.map(tool => ({
        name: tool.id,
        description: tool.description,
        parametersJsonSchema: toJsonSchema(tool.parameters),
    }));
}

export function toOpenAITools(tools: OrbitTool[]) {
    return tools.map(tool => ({
        type: "function",
        function: { name: tool.id, description: tool.description, parameters: toJsonSchema(tool.parameters) },
    }));
}

export function toAnthropicTools(tools: OrbitTool[]) {
    return tools.map(tool => ({
        name: tool.id,
        description: tool.description,
        input_schema: toJsonSchema(tool.parameters),
    }));
}

function toJsonSchema(schema: Record<string, unknown>): Record<string, unknown> {
    const { type, properties, items, ...keywords } = schema;
    return {
        ...keywords,
        ...(typeof type === "string" ? { type: type.toLowerCase() } : {}),
        ...(isRecord(properties)
            ? { properties: Object.fromEntries(Object.entries(properties).map(([key, value]) =>
                [key, isRecord(value) ? toJsonSchema(value) : value])) }
            : {}),
        ...(isRecord(items) ? { items: toJsonSchema(items) } : {}),
    };
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

export function parseToolArguments(value: unknown): Record<string, unknown> | undefined {
    if (typeof value === "string") {
        try {
            value = JSON.parse(value.trim().replace(/^\x60{3}(?:json)?\s*|\s*\x60{3}$/gi, ""));
        } catch {
            return undefined;
        }
    }
    return isRecord(value) ? value : undefined;
}

export function readFunctionCalls(entries: unknown): ProviderToolCall[] {
    if (!Array.isArray(entries)) return [];
    return entries.flatMap(entry => {
        if (!isRecord(entry) || !isRecord(entry.function)) return [];
        const { name, arguments: args } = entry.function;
        if (typeof name !== "string") return [];
        const id = typeof entry.id === "string" || typeof entry.id === "number" ? String(entry.id) : undefined;
        return [{ id, name, arguments: args }];
    });
}

export function isToolProtocolRejection(error: unknown): error is Error {
    if (!(error instanceof Error)) return false;
    const status: unknown = Reflect.get(error, "status");
    return status === 400 || status === 422 || status === 501;
}

export function normalizeToolCalls(calls: ProviderToolCall[], history: ToolExchange[]) {
    const seen = new Set(history.flatMap(exchange => exchange.outcomes.map(outcome => outcome.call.id)));
    return calls.map((call, index) => {
        const args = typeof call.arguments === "string" ? call.arguments : JSON.stringify(call.arguments ?? {});
        const seed = `${call.name}:${args}:${index}`;
        const deterministic = "call_" + createHash("sha256").update(seed).digest("hex").slice(0, 12);
        const rawId = call.id?.trim().split("|", 1)[0];
        const base = rawId && /^[\w-]{1,52}$/.test(rawId) ? rawId : deterministic;
        let id = base;
        for (let duplicate = 2; seen.has(id); duplicate++) id = `${base}_d${duplicate}`;
        seen.add(id);
        const name = /^[\w-]{1,64}$/.test(call.name) ? call.name : "unknown_tool";
        return { ...call, id, name };
    });
}

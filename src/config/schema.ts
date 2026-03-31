/**
 * Orbit Configuration Schema
 * Phase 0.2 — Zod-based validation for all Orbit config.
 */

import { z } from "zod";

const providerSchema = z.object({
    apiKey:  z.string().default(""),
    baseUrl: z.string().default(""),
    models:  z.record(z.string(), z.string()).default({}),
});

type ProviderDefaults = z.infer<typeof providerSchema>;
const defaultProvider = (): ProviderDefaults => ({ apiKey: "", baseUrl: "", models: {} });

export const orbitConfigSchema = z.object({
    providers: z.object({
        gemini:    providerSchema.default(defaultProvider),
        openai:    providerSchema.default(defaultProvider),
        anthropic: providerSchema.default(defaultProvider),
        ollama:    providerSchema.default(defaultProvider),
    }).default(() => ({
        gemini:    defaultProvider(),
        openai:    defaultProvider(),
        anthropic: defaultProvider(),
        ollama:    defaultProvider(),
    })),

    defaultProvider: z.enum(["gemini", "openai", "anthropic", "ollama"]).default("gemini"),

    fallbackChain: z.array(z.object({
        provider: z.string(),
        model:    z.string(),
    })).default([]),

    voice: z.object({
        voiceName: z.string().default("Aoede"),
        language:  z.string().default("es"),
    }).default(() => ({ voiceName: "Aoede", language: "es" })),

    toolProfile: z.enum(["minimal", "standard", "coding", "full"]).default("full"),

    security: z.object({
        approvalRequired: z.boolean().default(false),
        allowedPaths:     z.array(z.string()).default([]),
    }).default(() => ({ approvalRequired: false, allowedPaths: [] as string[] })),

    server: z.object({
        gatewayPort: z.number().default(18789),
        webPort:     z.number().default(3000),
    }).default(() => ({ gatewayPort: 18789, webPort: 3000 })),

    engine: z.object({
        pythonPort:        z.number().default(18790),
        heartbeatInterval: z.number().default(30000),
    }).default(() => ({ pythonPort: 18790, heartbeatInterval: 30000 })),

    logging: z.object({
        level: z.enum(["debug", "info", "warn", "error"]).default("info"),
    }).default(() => ({ level: "info" as const })),
});

export type OrbitConfig = z.infer<typeof orbitConfigSchema>;

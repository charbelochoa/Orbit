/**
 * Orbit Provider Registry
 * Phase 2.2 — Central registry with automatic fallback chain.
 * Phase 8.2 — Smart routing, rate-limit cooldown, health tracking.
 */

import { getConfig } from "../config/config.js";
import { createLogger } from "../infra/logger.js";
import { GeminiProvider } from "./gemini.js";
import { OpenAIProvider } from "./openai.js";
import { AnthropicProvider } from "./anthropic.js";
import { OllamaProvider } from "./ollama.js";
import type { LLMProvider, TextGenerationParams, TextGenerationResult } from "./types.js";

const log = createLogger("Providers");

// ── Phase 8.2: Provider Health Tracking ──────────────────────────────────────

interface ProviderHealth {
    totalCalls:    number;
    totalErrors:   number;
    totalTokensIn: number;
    totalTokensOut: number;
    avgLatencyMs:  number;
    lastError?:    string;
    lastErrorAt?:  number;
    cooldownUntil: number;  // timestamp — if Date.now() < this, skip provider
}

// ── Smart routing hints ──────────────────────────────────────────────────────

export type TaskHint = "long_context" | "tool_use" | "fast" | "private" | "code" | "general";

/**
 * Maps task hints to preferred provider order.
 * Used by smartRoute() for automatic provider selection.
 */
const ROUTING_TABLE: Record<TaskHint, string[]> = {
    long_context: ["gemini", "anthropic", "openai", "ollama"],
    tool_use:     ["openai", "gemini", "anthropic", "ollama"],
    fast:         ["gemini", "openai", "ollama", "anthropic"],
    private:      ["ollama", "gemini", "openai", "anthropic"],
    code:         ["anthropic", "openai", "gemini", "ollama"],
    general:      ["gemini", "openai", "anthropic", "ollama"],
};

const RATE_LIMIT_COOLDOWN_MS = 60_000; // 1 minute cooldown after 429

// ── Registry ─────────────────────────────────────────────────────────────────

class ProviderRegistryClass {
    private providers = new Map<string, LLMProvider>();
    private health    = new Map<string, ProviderHealth>();

    register(provider: LLMProvider): void {
        this.providers.set(provider.id, provider);
        this.health.set(provider.id, {
            totalCalls: 0, totalErrors: 0,
            totalTokensIn: 0, totalTokensOut: 0,
            avgLatencyMs: 0, cooldownUntil: 0,
        });
    }

    get(id: string): LLMProvider | undefined {
        return this.providers.get(id);
    }

    getAvailable(): LLMProvider[] {
        return Array.from(this.providers.values()).filter(p => p.isAvailable());
    }

    /** Check if a provider is healthy (available + not in cooldown). */
    isHealthy(id: string): boolean {
        const p = this.providers.get(id);
        if (!p?.isAvailable()) return false;
        const h = this.health.get(id);
        if (h && h.cooldownUntil > Date.now()) return false;
        return true;
    }

    getDefault(): LLMProvider {
        // Respect runtime override first (Phase 7)
        if (this._activeProviderId) {
            const p = this.providers.get(this._activeProviderId);
            if (p?.isAvailable()) return p;
        }
        const config = getConfig();
        const provider = this.providers.get(config.defaultProvider);
        if (provider?.isAvailable()) return provider;

        const available = this.getAvailable();
        if (available.length === 0) {
            throw new Error("No LLM providers available. Configure at least one API key.");
        }
        log.warn(`Default provider '${config.defaultProvider}' not available. Using '${available[0].id}'.`);
        return available[0];
    }

    /**
     * Generate text with automatic fallback.
     * Phase 8.2: rate-limit detection, cooldown, health tracking.
     */
    async generateText(params: TextGenerationParams): Promise<TextGenerationResult> {
        const config = getConfig();
        const chain = config.fallbackChain.length > 0
            ? config.fallbackChain
            : [{ provider: config.defaultProvider, model: "" }];

        let lastError: Error | null = null;

        for (const link of chain) {
            const provider = this.providers.get(link.provider);
            if (!provider?.isAvailable()) continue;

            // Phase 8.2: Skip provider if in cooldown
            if (!this.isHealthy(link.provider)) {
                const h = this.health.get(link.provider)!;
                const remaining = Math.ceil((h.cooldownUntil - Date.now()) / 1000);
                log.debug(`${link.provider} en cooldown (${remaining}s restantes). Saltando.`);
                continue;
            }

            try {
                const startMs = Date.now();
                const effectiveModel = params.model || link.model || undefined;
                const result = await provider.generateText({ ...params, model: effectiveModel });
                const elapsed = Date.now() - startMs;

                // Update health stats
                this.recordSuccess(link.provider, elapsed, result.usage);
                return result;
            } catch (e: any) {
                lastError = e;
                this.recordError(link.provider, e);
                log.warn(`${link.provider} failed: ${e.message}. Trying next...`);
            }
        }

        throw lastError || new Error("All providers in fallback chain failed or unavailable.");
    }

    /**
     * Phase 8.2: Smart routing — choose provider based on task type.
     * Falls back through preferred order, skipping unhealthy providers.
     */
    async smartGenerate(params: TextGenerationParams, hint: TaskHint = "general"): Promise<TextGenerationResult> {
        const preferredOrder = ROUTING_TABLE[hint] || ROUTING_TABLE.general;

        let lastError: Error | null = null;

        for (const providerId of preferredOrder) {
            if (!this.isHealthy(providerId)) continue;

            const provider = this.providers.get(providerId);
            if (!provider) continue;

            try {
                const startMs = Date.now();
                const result = await provider.generateText(params);
                this.recordSuccess(providerId, Date.now() - startMs, result.usage);
                return result;
            } catch (e: any) {
                lastError = e;
                this.recordError(providerId, e);
                log.warn(`Smart routing: ${providerId} failed (${hint}). Trying next...`);
            }
        }

        throw lastError || new Error(`Smart routing: all providers failed for hint '${hint}'.`);
    }

    // ── Health tracking ───────────────────────────────────────────────────────

    private recordSuccess(id: string, latencyMs: number, usage?: { inputTokens: number; outputTokens: number }): void {
        const h = this.health.get(id);
        if (!h) return;
        h.totalCalls++;
        h.avgLatencyMs = Math.round((h.avgLatencyMs * (h.totalCalls - 1) + latencyMs) / h.totalCalls);
        if (usage) {
            h.totalTokensIn  += usage.inputTokens;
            h.totalTokensOut += usage.outputTokens;
        }
    }

    private recordError(id: string, error: Error): void {
        const h = this.health.get(id);
        if (!h) return;
        h.totalErrors++;
        h.lastError   = error.message.slice(0, 200);
        h.lastErrorAt = Date.now();

        // Detect rate-limit (429) and apply cooldown
        const msg = error.message.toLowerCase();
        if (msg.includes("429") || msg.includes("rate") || msg.includes("quota") || msg.includes("limit")) {
            h.cooldownUntil = Date.now() + RATE_LIMIT_COOLDOWN_MS;
            log.warn(`${id} rate-limited → cooldown ${RATE_LIMIT_COOLDOWN_MS / 1000}s`);
        }
    }

    /** Get health stats for all providers (used by /doctor, /insights). */
    getHealthStats(): Record<string, ProviderHealth & { id: string; available: boolean }> {
        const stats: Record<string, ProviderHealth & { id: string; available: boolean }> = {};
        for (const [id, h] of this.health.entries()) {
            const p = this.providers.get(id);
            stats[id] = { ...h, id, available: !!p?.isAvailable() };
        }
        return stats;
    }

    /** List all registered provider IDs */
    listProviders(): string[] {
        return Array.from(this.providers.keys());
    }

    /** List available provider IDs (have valid credentials) */
    listAvailable(): string[] {
        return this.getAvailable().map(p => p.id);
    }

    // ── Runtime switching (Phase 7) ───────────────────────────────────────────

    private _activeProviderId: string | null = null;

    /** Override the active provider at runtime (used by /model command). */
    setActiveProvider(id: string): void {
        const p = this.providers.get(id);
        if (!p) throw new Error(`Unknown provider: "${id}". Available: ${this.listProviders().join(", ")}`);
        if (!p.isAvailable()) throw new Error(`Provider "${id}" has no valid API key.`);
        this._activeProviderId = id;
        log.info(`Active provider switched to: ${id}`);
    }

    /** Returns { id, name, models } for the currently active provider. */
    getActiveInfo(): { id: string; name: string; models: string[] } {
        const p = this._activeProviderId
            ? this.providers.get(this._activeProviderId)
            : this.getAvailable()[0];
        if (!p) return { id: "none", name: "none", models: [] };
        return { id: p.id, name: p.name, models: p.listModels() };
    }
}

// ── Singleton ────────────────────────────────────────────────────────────────

export const providerRegistry = new ProviderRegistryClass();

// Register built-in providers
providerRegistry.register(new GeminiProvider());
providerRegistry.register(new OpenAIProvider());
providerRegistry.register(new AnthropicProvider());
providerRegistry.register(new OllamaProvider());

// ── Convenience export ───────────────────────────────────────────────────────

/**
 * Generate text using the configured provider with automatic fallback.
 * Drop-in replacement for direct GoogleGenAI calls.
 */
export async function generateText(params: TextGenerationParams): Promise<TextGenerationResult> {
    return providerRegistry.generateText(params);
}

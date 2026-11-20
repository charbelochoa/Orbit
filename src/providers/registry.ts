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
import { jitteredBackoff, ProviderHttpError } from "./retry.js";
import { isToolProtocolRejection } from "./tool-adapter.js";

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
    consecutiveRateLimits?: number;
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
        const selection = this.getConfiguredSelection();
        if (!selection) throw new Error("No LLM providers available. Configure at least one API key.");
        return selection.provider;
    }

    private selectionChain(providerId?: string) {
        const config = getConfig();
        const primary = { provider: providerId || this._activeProviderId || config.defaultProvider, model: "" };
        if (providerId) return [primary];
        return [
            primary,
            ...config.fallbackChain,
            ...this.getAvailable().map(provider => ({ provider: provider.id, model: "" })),
        ];
    }

    private getConfiguredSelection() {
        for (const entry of this.selectionChain()) {
            const provider = this.providers.get(entry.provider);
            if (provider?.isAvailable()) return { provider, model: entry.model };
        }
        return undefined;
    }

    /**
     * Generate text with automatic fallback.
     * Phase 8.2: rate-limit detection, cooldown, health tracking.
     */
    async generateText(params: TextGenerationParams, providerId?: string): Promise<TextGenerationResult> {
        const chain = this.selectionChain(providerId);
        const primary = chain[0].provider;
        const attempted = new Set<string>();

        let lastError: Error | null = null;
        let toolProtocolError: Error | undefined;

        for (const link of chain) {
            params.signal?.throwIfAborted();
            const provider = this.providers.get(link.provider);
            if (!provider?.isAvailable()) continue;
            const effectiveModel = (link.provider === primary ? params.model : undefined) || link.model || undefined;
            const candidate = `${link.provider}:${effectiveModel ?? ""}`;
            if (attempted.has(candidate)) continue;
            attempted.add(candidate);

            // Phase 8.2: Skip provider if in cooldown
            if (!this.isHealthy(link.provider)) {
                const h = this.health.get(link.provider)!;
                const remaining = Math.ceil((h.cooldownUntil - Date.now()) / 1000);
                log.debug(`${link.provider} en cooldown (${remaining}s restantes). Saltando.`);
                continue;
            }

            try {
                const startMs = Date.now();
                const deadline = AbortSignal.timeout(45_000);
                const signal = params.signal ? AbortSignal.any([params.signal, deadline]) : deadline;
                const result = await provider.generateText({ ...params, model: effectiveModel, signal });
                params.signal?.throwIfAborted();
                const elapsed = Date.now() - startMs;

                // Update health stats
                this.recordSuccess(link.provider, elapsed, result.usage);
                return result;
            } catch (e: any) {
                params.signal?.throwIfAborted();
                lastError = e;
                if (params.toolContext && isToolProtocolRejection(e)) toolProtocolError ??= e;
                this.recordError(link.provider, e);
                log.warn(`${link.provider} failed: ${e.message}. Trying next...`);
            }
        }

        throw toolProtocolError || lastError || new Error("All providers in fallback chain failed or unavailable.");
    }

    /**
     * Phase 8.2: Smart routing — choose provider based on task type.
     * Falls back through preferred order, skipping unhealthy providers.
     */
    async smartGenerate(params: TextGenerationParams, hint: TaskHint = "general"): Promise<TextGenerationResult> {
        const preferredOrder = ROUTING_TABLE[hint] || ROUTING_TABLE.general;

        let lastError: Error | null = null;

        for (const providerId of preferredOrder) {
            params.signal?.throwIfAborted();
            if (!this.isHealthy(providerId)) continue;

            const provider = this.providers.get(providerId);
            if (!provider) continue;

            try {
                const startMs = Date.now();
                const result = await provider.generateText(params);
                this.recordSuccess(providerId, Date.now() - startMs, result.usage);
                return result;
            } catch (e: any) {
                params.signal?.throwIfAborted();
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
        if (h.cooldownUntil <= Date.now()) {
            h.consecutiveRateLimits = 0;
            h.cooldownUntil = 0;
        }
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
        const status = (error as Error & { status?: number }).status;
        if (status === 429 || /\b429\b|rate.limit|resource_exhausted|quota exceeded/i.test(error.message)) {
            const attempt = (h.consecutiveRateLimits ?? 0) + 1;
            h.consecutiveRateLimits = attempt;
            const retryAfter = error instanceof ProviderHttpError ? error.retryAfter : undefined;
            const delay = retryAfter ?? jitteredBackoff(attempt, RATE_LIMIT_COOLDOWN_MS, 120_000);
            h.cooldownUntil = Math.max(h.cooldownUntil, Date.now() + Math.ceil(delay));
            log.warn(`${id} en pausa por límite de solicitudes durante ${Math.ceil(delay / 1000)}s.`);
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
    getActiveInfo(): { id: string; name: string; model?: string; models: string[] } {
        const selection = this.getConfiguredSelection();
        if (!selection) return { id: "none", name: "none", models: [] };
        const { provider } = selection;
        const model = selection.model || provider.defaultTextModel();
        const config = Object.entries(getConfig().providers).find(([id]) => id === provider.id)?.[1];
        const configured = Object.values(config?.models ?? {});
        const models = [...new Set([model, ...configured, ...provider.listModels()].filter(Boolean))];
        return { id: provider.id, name: provider.name, model, models };
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

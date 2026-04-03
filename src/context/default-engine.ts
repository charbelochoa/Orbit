/**
 * Orbit Default Context Engine — Sprint 2
 * Manages the conversation context with token budgeting, compaction, and memory injection.
 *
 * Strategy:
 * - Keeps a sliding window of recent messages
 * - When token budget exceeds 70%, compacts older messages via LLM summary
 * - Assembles: system prompt → memory → skill hints → compacted summaries → recent messages
 */

import type {
    ContextEngine, ChatMessage, AssembleOptions,
    CompactOptions, CompactResult, TurnResult, ContextStats,
} from "./context-engine.js";
import { estimateTokens } from "./token-counter.js";
import { compactMessages } from "./compactor.js";
import { getHistory, addMessage } from "../memory/chat-history.js";
import { loadMemory, formatMemoryForPrompt } from "../memory/memory-manager.js";
import { getSystemPrompt } from "../core/prompt.js";
import { skillRegistry } from "../skills/registry.js";
import { createLogger } from "../infra/logger.js";
import { runHooks } from "../hooks/runner.js";

const log = createLogger("context");

/** Auto-compact when token usage exceeds this % of budget */
const COMPACT_THRESHOLD = 0.70;

/** Keep this many recent messages uncompacted (they stay full-fidelity) */
const RECENT_WINDOW = 20;

/** Default token budget if not specified */
const DEFAULT_BUDGET = 120_000;

export class DefaultContextEngine implements ContextEngine {
    private sessionId = "";
    private messages: ChatMessage[] = [];
    private summaries: ChatMessage[] = [];
    private compactionCount = 0;
    private lastCompactedAt?: Date;

    // ── Lifecycle ────────────────────────────────────────────────────────────

    async bootstrap(sessionId: string): Promise<void> {
        this.sessionId = sessionId;
        this.messages = [];
        this.summaries = [];
        this.compactionCount = 0;
        this.lastCompactedAt = undefined;

        // Load existing chat history into the engine
        const history = getHistory(sessionId, 100);
        for (const msg of history) {
            this.messages.push({
                role: msg.role as ChatMessage["role"],
                content: msg.content,
                tokens: estimateTokens(msg.content),
            });
        }

        log.info(`Context bootstrapped for session ${sessionId} — ${this.messages.length} messages loaded`);
    }

    // ── Ingest ───────────────────────────────────────────────────────────────

    ingest(messages: ChatMessage[]): void {
        for (const msg of messages) {
            if (!msg.tokens) msg.tokens = estimateTokens(msg.content);
            this.messages.push(msg);
        }
    }

    // ── Assemble ─────────────────────────────────────────────────────────────

    async assemble(opts: AssembleOptions): Promise<ChatMessage[]> {
        const budget = (opts.tokenBudget || DEFAULT_BUDGET) - (opts.reserveForResponse || 4000);
        const assembled: ChatMessage[] = [];
        let usedTokens = 0;

        // 1. System prompt (with memory + datetime baked in, as getSystemPrompt expects)
        if (opts.includeSystemPrompt) {
            const mem = opts.includeMemory ? await loadMemory() : null;
            const memText = mem ? formatMemoryForPrompt(mem) : "Sin datos guardados del usuario.";
            const now = new Date().toLocaleString("es-ES", { dateStyle: "full", timeStyle: "short" });
            const sysPrompt = getSystemPrompt(memText, now);
            const sysTokens = estimateTokens(sysPrompt);
            assembled.push({ role: "system", content: sysPrompt, tokens: sysTokens });
            usedTokens += sysTokens;
        }

        // 3. Relevant skills
        if (opts.includeSkills && opts.goal) {
            const skills = skillRegistry.findRelevant(opts.goal, 2);
            if (skills.length > 0) {
                const skillsBlock = skills
                    .map(s => `--- SKILL: ${s.metadata.emoji} ${s.metadata.name} ---\n${s.content.slice(0, 500)}`)
                    .join("\n\n");
                const skillTokens = estimateTokens(skillsBlock);
                if (usedTokens + skillTokens < budget * 0.25) {
                    assembled.push({
                        role: "system",
                        content: `[RELEVANT SKILLS]\n${skillsBlock}`,
                        tokens: skillTokens,
                    });
                    usedTokens += skillTokens;
                }
            }
        }

        // 4. Compacted summaries (oldest context, compressed)
        for (const summary of this.summaries) {
            const tokens = summary.tokens ?? estimateTokens(summary.content);
            if (usedTokens + tokens > budget * 0.85) break;
            assembled.push(summary);
            usedTokens += tokens;
        }

        // 5. Recent messages (newest, full fidelity) — fill remaining budget
        const remaining = budget - usedTokens;
        const recentMessages: ChatMessage[] = [];
        let recentTokens = 0;

        // Walk backward from newest to find messages that fit
        for (let i = this.messages.length - 1; i >= 0; i--) {
            const msg = this.messages[i];
            const tokens = msg.tokens ?? estimateTokens(msg.content);
            if (recentTokens + tokens > remaining) break;
            recentMessages.unshift(msg);
            recentTokens += tokens;
        }

        assembled.push(...recentMessages);
        usedTokens += recentTokens;

        log.debug(`Assembled ${assembled.length} messages (≈${usedTokens} tokens, budget: ${budget})`);
        return assembled;
    }

    // ── Compact ──────────────────────────────────────────────────────────────

    async compact(opts?: CompactOptions): Promise<CompactResult> {
        const totalTokens = this.messages.reduce((s, m) => s + (m.tokens ?? estimateTokens(m.content)), 0);

        if (!opts?.force && totalTokens < DEFAULT_BUDGET * COMPACT_THRESHOLD) {
            return { tokensBefore: totalTokens, tokensAfter: totalTokens, summarized: 0 };
        }

        // Split: compact old messages, keep recent window
        const oldMessages = this.messages.slice(0, -RECENT_WINDOW);
        const recentMessages = this.messages.slice(-RECENT_WINDOW);

        if (oldMessages.length < 4) {
            return { tokensBefore: totalTokens, tokensAfter: totalTokens, summarized: 0 };
        }

        await runHooks("CompactStart", { cwd: process.cwd() });

        const tokensBefore = oldMessages.reduce((s, m) => s + (m.tokens ?? estimateTokens(m.content)), 0);
        const { summary, tokensSaved } = await compactMessages(oldMessages);

        this.summaries.push(summary);
        this.messages = recentMessages;
        this.compactionCount++;
        this.lastCompactedAt = new Date();

        const tokensAfter = totalTokens - tokensSaved;

        log.info(`Compacted: ${oldMessages.length} msgs → 1 summary, saved ≈${tokensSaved} tokens`);

        await runHooks("CompactDone", { cwd: process.cwd() });

        return { tokensBefore: totalTokens, tokensAfter, summarized: oldMessages.length };
    }

    // ── After Turn ───────────────────────────────────────────────────────────

    async afterTurn(result: TurnResult): Promise<void> {
        // Persist to SQLite
        if (this.sessionId) {
            addMessage(this.sessionId, "user", result.userMessage);
            addMessage(this.sessionId, "assistant", result.assistantMessage);
        }

        // Check if we need auto-compaction
        const totalTokens = this.messages.reduce((s, m) => s + (m.tokens ?? estimateTokens(m.content)), 0);
        if (totalTokens > DEFAULT_BUDGET * COMPACT_THRESHOLD) {
            log.info(`Auto-compact triggered (≈${totalTokens} tokens, threshold: ${Math.floor(DEFAULT_BUDGET * COMPACT_THRESHOLD)})`);
            await this.compact();
        }

        await runHooks("TurnAfter", { cwd: process.cwd() });
    }

    // ── Stats ────────────────────────────────────────────────────────────────

    stats(): ContextStats {
        return {
            totalTokens: this.messages.reduce((s, m) => s + (m.tokens ?? estimateTokens(m.content)), 0),
            messageCount: this.messages.length,
            compactionCount: this.compactionCount,
            lastCompactedAt: this.lastCompactedAt,
        };
    }
}

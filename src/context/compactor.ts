/**
 * Orbit Compactor — Sprint 2
 * Summarizes old conversation messages to free token budget.
 *
 * Uses the LLM to create a concise summary that preserves:
 * - Key facts and decisions
 * - Context needed for ongoing tasks
 * - User preferences mentioned
 */

import { generateText } from "../providers/registry.js";
import { estimateTokens } from "./token-counter.js";
import type { ChatMessage } from "./context-engine.js";
import { createLogger } from "../infra/logger.js";

const log = createLogger("context");

const COMPACTION_PROMPT = `You are a conversation compactor. Summarize the following conversation excerpt into a concise summary that preserves:
1. Key facts, decisions, and outcomes
2. Important context for ongoing tasks
3. User preferences and corrections
4. Tool results that may be referenced later

Rules:
- Write in the same language as the conversation
- Be concise but don't lose critical information
- Use bullet points for clarity
- Max 300 words

Conversation to summarize:`;

/**
 * Summarize a batch of messages into a single compact summary.
 * Returns a system message containing the summary.
 */
export async function compactMessages(
    messages: ChatMessage[],
): Promise<{ summary: ChatMessage; tokensSaved: number }> {
    const conversationText = messages
        .map(m => `[${m.role}]: ${m.content}`)
        .join("\n\n");

    const tokensBefore = messages.reduce((sum, m) => sum + (m.tokens ?? estimateTokens(m.content)), 0);

    log.info(`Compactando ${messages.length} mensajes (≈${tokensBefore} tokens)...`);

    try {
        const response = await generateText({
            messages: [{
                role: "user",
                content: `${COMPACTION_PROMPT}\n\n${conversationText}`,
            }],
        });

        const summaryText = response.text?.trim() || "No se pudo generar resumen.";
        const tokensAfter = estimateTokens(summaryText);

        log.info(`Compactación: ${tokensBefore} → ${tokensAfter} tokens (${messages.length} msgs → 1 resumen)`);

        return {
            summary: {
                role: "system",
                content: `[CONVERSATION SUMMARY]\n${summaryText}`,
                tokens: tokensAfter,
            },
            tokensSaved: tokensBefore - tokensAfter,
        };
    } catch (e: any) {
        log.error(`Compactación falló: ${e.message}`);
        // Fallback: truncate instead of summarizing
        const truncated = messages.slice(-5)
            .map(m => `[${m.role}]: ${m.content.slice(0, 100)}`)
            .join("\n");
        const fallbackTokens = estimateTokens(truncated);

        return {
            summary: {
                role: "system",
                content: `[CONVERSATION SUMMARY (truncated)]\n${truncated}`,
                tokens: fallbackTokens,
            },
            tokensSaved: tokensBefore - fallbackTokens,
        };
    }
}

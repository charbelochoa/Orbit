/**
 * Orbit Token Counter — Sprint 2
 * Fast token estimation for context budget management.
 *
 * Uses a simple heuristic: ~4 characters per token (for English/Spanish mix).
 * Accurate enough for budget decisions without requiring tiktoken dependency.
 */

/** Estimate token count for a string */
export function estimateTokens(text: string): number {
    if (!text) return 0;
    // Heuristic: average 4 chars per token for English, ~3 for CJK
    // This is a rough estimate that works well for budget decisions
    const cjkChars = (text.match(/[\u3000-\u9fff\uac00-\ud7af]/g) || []).length;
    const otherChars = text.length - cjkChars;
    return Math.ceil(otherChars / 4 + cjkChars);
}

/** Estimate token count for a message array */
export function estimateMessagesTokens(messages: Array<{ content: string }>): number {
    let total = 0;
    for (const m of messages) {
        total += estimateTokens(m.content) + 4; // +4 for role/formatting overhead
    }
    return total;
}

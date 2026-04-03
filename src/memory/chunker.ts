/**
 * Orbit Text Chunker — Sprint 3
 * Splits text into overlapping chunks for embedding.
 *
 * Strategy:
 * - Split on paragraph boundaries (double newlines)
 * - Merge small paragraphs into chunks until maxTokens is reached
 * - Overlap: include last N tokens from previous chunk in next chunk
 */

import { estimateTokens } from "../context/token-counter.js";

export interface TextChunk {
    text:       string;
    /** Token count (estimated) */
    tokens:     number;
    /** Start offset in original text (chars) */
    startChar:  number;
    /** End offset in original text (chars) */
    endChar:    number;
    /** Chunk index (0-based) */
    index:      number;
}

export interface ChunkOptions {
    /** Max tokens per chunk (default: 512) */
    maxTokens?: number;
    /** Overlap tokens between consecutive chunks (default: 50) */
    overlap?:   number;
}

/**
 * Split text into overlapping chunks.
 */
export function chunkText(text: string, opts?: ChunkOptions): TextChunk[] {
    const maxTokens = opts?.maxTokens ?? 512;
    const overlap   = opts?.overlap   ?? 50;

    if (!text || text.trim().length === 0) return [];

    // Split on paragraph boundaries
    const paragraphs = text.split(/\n\s*\n/);
    const chunks: TextChunk[] = [];

    let currentParts: string[] = [];
    let currentTokens = 0;
    let currentStartChar = 0;
    let charCursor = 0;

    for (const para of paragraphs) {
        const paraTokens = estimateTokens(para);
        const paraLen    = para.length;

        // If a single paragraph exceeds maxTokens, split it by sentences
        if (paraTokens > maxTokens) {
            // Flush current buffer first
            if (currentParts.length > 0) {
                const chunkText = currentParts.join("\n\n");
                chunks.push({
                    text:      chunkText,
                    tokens:    currentTokens,
                    startChar: currentStartChar,
                    endChar:   charCursor,
                    index:     chunks.length,
                });
                // Overlap: keep the last part
                const overlapText = getOverlapSuffix(chunkText, overlap);
                currentParts   = overlapText ? [overlapText] : [];
                currentTokens  = estimateTokens(overlapText);
                currentStartChar = charCursor - overlapText.length;
            }

            // Split large paragraph by sentences
            const sentences = para.match(/[^.!?]+[.!?]+|\S[^.!?]*$/g) || [para];
            for (const sentence of sentences) {
                const sentTokens = estimateTokens(sentence);
                if (currentTokens + sentTokens > maxTokens && currentParts.length > 0) {
                    const chunkText = currentParts.join(" ");
                    chunks.push({
                        text:      chunkText,
                        tokens:    currentTokens,
                        startChar: currentStartChar,
                        endChar:   charCursor,
                        index:     chunks.length,
                    });
                    const overlapText = getOverlapSuffix(chunkText, overlap);
                    currentParts   = overlapText ? [overlapText] : [];
                    currentTokens  = estimateTokens(overlapText);
                    currentStartChar = charCursor - overlapText.length;
                }
                currentParts.push(sentence.trim());
                currentTokens += sentTokens;
            }
        } else {
            // Normal paragraph — check if it fits in current chunk
            if (currentTokens + paraTokens > maxTokens && currentParts.length > 0) {
                const chunkText = currentParts.join("\n\n");
                chunks.push({
                    text:      chunkText,
                    tokens:    currentTokens,
                    startChar: currentStartChar,
                    endChar:   charCursor,
                    index:     chunks.length,
                });
                const overlapText = getOverlapSuffix(chunkText, overlap);
                currentParts   = overlapText ? [overlapText] : [];
                currentTokens  = estimateTokens(overlapText);
                currentStartChar = charCursor - overlapText.length;
            }
            currentParts.push(para.trim());
            currentTokens += paraTokens;
        }

        // Advance char cursor (paragraph + separator)
        charCursor += paraLen + 2; // +2 for "\n\n"
    }

    // Flush remaining
    if (currentParts.length > 0) {
        const chunkText = currentParts.join("\n\n");
        chunks.push({
            text:      chunkText,
            tokens:    currentTokens,
            startChar: currentStartChar,
            endChar:   Math.min(charCursor, text.length),
            index:     chunks.length,
        });
    }

    return chunks;
}

/**
 * Get the last ~N tokens of text for overlap.
 */
function getOverlapSuffix(text: string, overlapTokens: number): string {
    if (overlapTokens <= 0) return "";
    // Approximate: 4 chars per token
    const chars = overlapTokens * 4;
    if (text.length <= chars) return text;
    return text.slice(-chars);
}

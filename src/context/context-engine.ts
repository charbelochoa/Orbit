/**
 * Orbit Context Engine — Sprint 2
 * Pluggable interface for intelligent context management.
 *
 * The Context Engine sits between chat history and the LLM, controlling
 * what gets sent in each request by assembling messages under a token budget.
 *
 * Lifecycle: bootstrap → ingest* → assemble → afterTurn → compact (if needed)
 */

// ── Types ────────────────────────────────────────────────────────────────────

export interface ChatMessage {
    role:    "system" | "user" | "assistant" | "tool";
    content: string;
    /** Optional: pre-counted token count for this message */
    tokens?: number;
}

export interface AssembleOptions {
    /** Max tokens for the assembled context (model context window) */
    tokenBudget:        number;
    /** Tokens to reserve for the model response */
    reserveForResponse: number;
    /** Include the system prompt in the assembled context */
    includeSystemPrompt: boolean;
    /** Include long-term memory facts */
    includeMemory:       boolean;
    /** Include relevant skill content */
    includeSkills:       boolean;
    /** Current user goal (for skill matching) */
    goal?:               string;
}

export interface CompactOptions {
    /** Force compaction even if under threshold */
    force?: boolean;
}

export interface CompactResult {
    tokensBefore: number;
    tokensAfter:  number;
    /** Number of messages that were summarized */
    summarized:   number;
}

export interface TurnResult {
    userMessage:      string;
    assistantMessage: string;
    toolCalls?:       string[];
}

export interface ContextStats {
    totalTokens:     number;
    messageCount:    number;
    compactionCount: number;
    lastCompactedAt?: Date;
}

// ── Interface ────────────────────────────────────────────────────────────────

export interface ContextEngine {
    /** Ingest messages from the current turn */
    ingest(messages: ChatMessage[]): void;

    /** Assemble context under token budget for sending to the model */
    assemble(opts: AssembleOptions): Promise<ChatMessage[]>;

    /** Compact the history (summarize old messages to free tokens) */
    compact(opts?: CompactOptions): Promise<CompactResult>;

    /** Post-turn work: persist, trigger auto-compact if needed */
    afterTurn(result: TurnResult): Promise<void>;

    /** Initialize for a session */
    bootstrap(sessionId: string): Promise<void>;

    /** Get stats about the current context state */
    stats(): ContextStats;
}

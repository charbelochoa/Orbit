/**
 * OrbitToolError — Structured errors optimized for LLM self-correction.
 *
 * When a tool fails, instead of a raw string the LLM receives a JSON object
 * with code, suggestion, and optionally valid values so it can retry correctly
 * on the first attempt.
 */

export type OrbitErrorCode =
    | "INVALID_PARAMS"
    | "TOOL_FAILED"
    | "PERMISSION_DENIED"
    | "NOT_FOUND"
    | "TIMEOUT"
    | "UNSUPPORTED_PLATFORM"
    | "DEPENDENCY_MISSING"
    | "LIMIT_EXCEEDED";

export interface OrbitErrorPayload {
    error:        OrbitErrorCode;
    tool:         string;
    message:      string;
    suggestion?:  string;
    validValues?: string[];
    context?:     Record<string, unknown>;
}

export class OrbitToolError extends Error {
    readonly code:        OrbitErrorCode;
    readonly tool:        string;
    readonly suggestion?: string;
    readonly validValues?: string[];
    readonly context?:    Record<string, unknown>;

    constructor(
        tool: string,
        code: OrbitErrorCode,
        message: string,
        opts?: {
            suggestion?:  string;
            validValues?: string[];
            context?:     Record<string, unknown>;
        },
    ) {
        super(message);
        this.name        = "OrbitToolError";
        this.tool        = tool;
        this.code        = code;
        this.suggestion  = opts?.suggestion;
        this.validValues = opts?.validValues;
        this.context     = opts?.context;
    }

    /** Compact JSON string the LLM can parse to self-correct. */
    toAgentString(): string {
        const payload: OrbitErrorPayload = {
            error:   this.code,
            tool:    this.tool,
            message: this.message,
        };
        if (this.suggestion)  payload.suggestion  = this.suggestion;
        if (this.validValues) payload.validValues  = this.validValues;
        if (this.context)     payload.context      = this.context;
        return JSON.stringify(payload);
    }
}

/**
 * Visual Agent Loop — Type definitions (Phase 1 prep for Phase 2 implementation).
 *
 * These types define the contract for the see→think→act autonomous loop
 * inspired by UI-TARS's VLM architecture but adapted to Orbit's multi-provider system.
 */

// ── Visual Action Space ─────────────────────────────────────────────────────

export type VisualActionType =
    | "click"
    | "double_click"
    | "right_click"
    | "type"
    | "hotkey"
    | "scroll"
    | "drag"
    | "move"
    | "wait"
    | "screenshot_and_continue"
    | "finished"
    | "call_user";

export interface VisualAction {
    action: VisualActionType;
    /** Thought/reasoning from the VLM before acting */
    thought?: string;
    /** Screen coordinates (logical pixels, pre-DPI-scaling) */
    x?: number;
    y?: number;
    /** End coordinates for drag actions */
    endX?: number;
    endY?: number;
    /** Text to type */
    text?: string;
    /** Key combo for hotkey actions (e.g. "ctrl+s") */
    keys?: string;
    /** Scroll direction */
    direction?: "up" | "down" | "left" | "right";
    /** Scroll amount (clicks) */
    amount?: number;
    /** Result message for finished/call_user */
    result?: string;
}

// ── Loop Status ──────────────────────────────────────────────────────────────

export type VisualLoopStatus =
    | "idle"
    | "running"
    | "paused"
    | "finished"
    | "call_user"
    | "error"
    | "stopped"
    | "max_loops";

// ── Loop Events ──────────────────────────────────────────────────────────────

export interface VisualLoopStep {
    loopIndex:   number;
    action:      VisualAction;
    /** Base64 screenshot taken before this step */
    screenshotB64?: string;
    /** Tool output after executing the action */
    toolOutput?: string;
    /** Timestamp (ms) when step started */
    startedAt:   number;
    /** Duration of execution in ms */
    durationMs?: number;
}

export interface VisualLoopResult {
    status:     VisualLoopStatus;
    steps:      VisualLoopStep[];
    totalLoops: number;
    /** Final message from the agent */
    summary:    string;
    /** Total elapsed time in ms */
    elapsedMs:  number;
}

// ── Loop Options ─────────────────────────────────────────────────────────────

export interface VisualLoopOptions {
    /** Maximum iterations before force-stop (default: from config agent.maxVisualLoops) */
    maxLoops?:    number;
    /** Callback fired after each step for UI updates */
    onStep?:      (step: VisualLoopStep) => void;
    /** Callback when status changes */
    onStatus?:    (status: VisualLoopStatus) => void;
    /** Optional session ID for context engine integration */
    sessionId?:   string;
    /** AbortSignal for external cancellation */
    signal?:      AbortSignal;
}

// ── DPI / Display Info ───────────────────────────────────────────────────────

export interface DisplayInfo {
    /** Logical screen width (what the OS reports) */
    logicalWidth:  number;
    /** Logical screen height */
    logicalHeight: number;
    /** Physical pixel width of the screenshot image */
    physicalWidth:  number;
    /** Physical pixel height of the screenshot image */
    physicalHeight: number;
    /** Scale factor (physicalWidth / logicalWidth) */
    scaleFactor:    number;
}

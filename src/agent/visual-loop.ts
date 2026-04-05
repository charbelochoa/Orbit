/**
 * VisualAgentLoop — Autonomous see→think→act loop for desktop control.
 *
 * Inspired by UI-TARS's GUIAgent pattern, adapted to Orbit's multi-provider
 * system and existing tool infrastructure.
 *
 * Usage:
 *   const loop = new VisualAgentLoop();
 *   const result = await loop.run("Open Notepad and type Hello World");
 *   loop.pause();   // blocks loop until resume
 *   loop.resume();  // continues
 *   loop.stop();    // terminates cleanly
 */

import screenshot from "screenshot-desktop";
import os from "os";
import path from "path";
import fs from "fs/promises";
import { generateText } from "../providers/registry.js";
import { createLogger } from "../infra/logger.js";
import { broadcast } from "../gateway/server.js";
import { getConfig } from "../config/config.js";
import { computerControl } from "../actions/computer-control.js";
import { getScreenSize, getCursorPos } from "../actions/ps-bridge.js";
import { buildVisualSystemPrompt } from "./visual-prompt.js";
import { parseVisualAction } from "./vision-action-parser.js";
import type { ChatMessage } from "../providers/types.js";
import type {
    VisualAction,
    VisualLoopStatus,
    VisualLoopStep,
    VisualLoopResult,
    VisualLoopOptions,
    DisplayInfo,
} from "./visual-types.js";

const log = createLogger("visual-loop");

// ── Screenshot helpers ───────────────────────────────────────────────────────

/** Read PNG dimensions from the IHDR chunk. */
function getPngDimensions(buf: Buffer): { w: number; h: number } {
    if (buf.length > 24 && buf[0] === 0x89 && buf[1] === 0x50) {
        return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
    }
    return { w: 0, h: 0 };
}

async function captureScreenshot(): Promise<{ base64: string; display: DisplayInfo }> {
    const tempPath = path.join(os.tmpdir(), `orbit_vl_${Date.now()}.png`);
    await screenshot({ filename: tempPath });
    const buf = await fs.readFile(tempPath);
    try { await fs.unlink(tempPath); } catch { /* ok */ }

    const base64 = buf.toString("base64");
    const dims = getPngDimensions(buf);
    const [logW, logH] = await getScreenSize();
    const physW = dims.w || logW;
    const physH = dims.h || logH;

    return {
        base64,
        display: {
            logicalWidth:   logW,
            logicalHeight:  logH,
            physicalWidth:  physW,
            physicalHeight: physH,
            scaleFactor:    physW / logW,
        },
    };
}

// ── Action Executor ──────────────────────────────────────────────────────────

/**
 * Map a VisualAction to an existing Orbit tool call.
 * Returns the tool output string.
 */
async function executeVisualAction(action: VisualAction, display: DisplayInfo): Promise<string> {
    switch (action.action) {
        case "click":
            return computerControl({ action: "click", x: action.x, y: action.y });
        case "double_click":
            return computerControl({ action: "double_click", x: action.x, y: action.y });
        case "right_click":
            return computerControl({ action: "right_click", x: action.x, y: action.y });
        case "type":
            return computerControl({ action: "type", text: action.text || "" });
        case "hotkey":
            return computerControl({ action: "hotkey", keys: action.keys || "" });
        case "scroll":
            return computerControl({
                action: "scroll",
                direction: action.direction || "down",
                amount: action.amount ?? 3,
            });
        case "drag": {
            // move to start, mouse down, move to end, mouse up
            await computerControl({ action: "click", x: action.x, y: action.y });
            // Use PS bridge drag: mouseDown at start, bezier move to end, mouseUp
            const { runPS, buildBezierScript } = await import("../actions/ps-bridge.js");
            const startX = action.x ?? 0;
            const startY = action.y ?? 0;
            const endX = action.endX ?? startX;
            const endY = action.endY ?? startY;
            await runPS(`[OrbitInput]::MouseDown(); ${buildBezierScript(startX, startY, endX, endY)} [OrbitInput]::MouseUp()`);
            return `Drag from (${startX},${startY}) to (${endX},${endY})`;
        }
        case "move":
            return computerControl({ action: "move", x: action.x, y: action.y });
        case "wait":
            await new Promise(r => setTimeout(r, 2000));
            return "Waited 2 seconds.";
        case "screenshot_and_continue":
            return "Took a new screenshot.";
        case "finished":
            return action.result || "Task completed.";
        case "call_user":
            return action.result || "Need user input.";
        default:
            return `Unknown action: ${action.action}`;
    }
}

// ── Main Loop Class ──────────────────────────────────────────────────────────

export class VisualAgentLoop {
    private _status: VisualLoopStatus = "idle";
    private _isPaused = false;
    private _isStopped = false;
    private _pausePromise: Promise<void> | null = null;
    private _resumeResolve: (() => void) | null = null;

    get status(): VisualLoopStatus { return this._status; }

    /** Pause the loop — blocks at next iteration until resume() is called. */
    pause(): void {
        if (this._status !== "running") return;
        this._isPaused = true;
        this._pausePromise = new Promise(r => { this._resumeResolve = r; });
        this._status = "paused";
        log.info("Loop paused");
        broadcast({ type: "visual_loop_status", status: "paused" });
    }

    /** Resume a paused loop. */
    resume(): void {
        if (!this._isPaused) return;
        this._isPaused = false;
        this._status = "running";
        this._resumeResolve?.();
        this._pausePromise = null;
        log.info("Loop resumed");
        broadcast({ type: "visual_loop_status", status: "running" });
    }

    /** Stop the loop cleanly after the current step completes. */
    stop(): void {
        this._isStopped = true;
        // Also unblock if paused
        if (this._isPaused) this.resume();
        log.info("Loop stop requested");
    }

    /**
     * Run the autonomous visual loop for a given goal.
     *
     * Loop: screenshot → LLM → parseAction → execute → repeat
     * Terminates on: finished(), call_user(), maxLoops, stop(), error.
     */
    async run(goal: string, opts?: VisualLoopOptions): Promise<VisualLoopResult> {
        const cfg = getConfig().agent;
        const maxLoops = opts?.maxLoops ?? cfg?.maxVisualLoops ?? 25;
        const startTime = Date.now();
        const steps: VisualLoopStep[] = [];
        const messages: ChatMessage[] = [];

        this._status = "running";
        this._isPaused = false;
        this._isStopped = false;
        opts?.onStatus?.("running");
        broadcast({ type: "visual_loop_status", status: "running", goal });

        // Get screen info for system prompt
        const [screenW, screenH] = await getScreenSize();
        const systemPrompt = buildVisualSystemPrompt(screenW, screenH);

        // Initial user message with the goal
        messages.push({ role: "user", content: `TASK: ${goal}` });

        log.info(`Visual loop started — goal: "${goal.slice(0, 80)}" maxLoops: ${maxLoops}`);

        let loopIndex = 0;

        while (loopIndex < maxLoops && !this._isStopped) {
            // ── Pause gate ───────────────────────────────────────────────
            if (this._isPaused && this._pausePromise) {
                await this._pausePromise;
            }
            if (this._isStopped) break;

            // ── Check AbortSignal ────────────────────────────────────────
            if (opts?.signal?.aborted) {
                this._isStopped = true;
                break;
            }

            const stepStart = Date.now();
            loopIndex++;
            log.info(`Loop ${loopIndex}/${maxLoops}`);

            try {
                // 1. Screenshot
                const { base64, display } = await captureScreenshot();

                // 2. Build the message with screenshot
                // We append the screenshot as a user message describing current state.
                // The provider registry's generateText only supports text messages,
                // so we describe the visual context textually + pass screenshot ref.
                // For actual multimodal, we use Gemini's inline data via a direct call fallback.
                const vlmResponse = await this._callVLM(systemPrompt, messages, base64, display);

                // 3. Parse action
                const action = parseVisualAction(vlmResponse);
                log.info(`Step ${loopIndex}: Thought="${(action.thought || "").slice(0, 80)}" Action=${action.action}`);

                // 4. Execute action
                const toolOutput = await executeVisualAction(action, display);

                // 5. Build step record
                const step: VisualLoopStep = {
                    loopIndex,
                    action,
                    screenshotB64: base64.slice(0, 100) + "...", // truncate for memory
                    toolOutput,
                    startedAt: stepStart,
                    durationMs: Date.now() - stepStart,
                };
                steps.push(step);
                opts?.onStep?.(step);

                // 6. Broadcast for UI
                broadcast({
                    type: "visual_loop_step",
                    loop: loopIndex,
                    maxLoops,
                    action: action.action,
                    thought: action.thought,
                    x: action.x,
                    y: action.y,
                    toolOutput: toolOutput.slice(0, 200),
                });

                // 7. Append to conversation history (sliding window)
                messages.push({
                    role: "assistant",
                    content: vlmResponse,
                });
                messages.push({
                    role: "user",
                    content: `[Screenshot taken after action. Tool result: ${toolOutput.slice(0, 300)}]\nContinue with the task. What do you see and what should you do next?`,
                });

                // Keep conversation history manageable (last 20 exchanges)
                while (messages.length > 40) {
                    // Remove the oldest user+assistant pair (after the initial goal)
                    messages.splice(1, 2);
                }

                // 8. Check terminal actions
                if (action.action === "finished") {
                    this._status = "finished";
                    opts?.onStatus?.("finished");
                    broadcast({ type: "visual_loop_status", status: "finished", result: action.result });
                    log.info(`Loop finished: ${action.result}`);
                    return {
                        status: "finished",
                        steps,
                        totalLoops: loopIndex,
                        summary: action.result || "Task completed.",
                        elapsedMs: Date.now() - startTime,
                    };
                }

                if (action.action === "call_user") {
                    this._status = "call_user";
                    opts?.onStatus?.("call_user");
                    broadcast({ type: "visual_loop_status", status: "call_user", result: action.result });
                    log.info(`Loop needs user: ${action.result}`);
                    return {
                        status: "call_user",
                        steps,
                        totalLoops: loopIndex,
                        summary: action.result || "Need user input.",
                        elapsedMs: Date.now() - startTime,
                    };
                }

            } catch (err: any) {
                log.error(`Loop ${loopIndex} error: ${err.message}`);
                steps.push({
                    loopIndex,
                    action: { action: "wait", thought: `Error: ${err.message}` },
                    startedAt: stepStart,
                    durationMs: Date.now() - stepStart,
                    toolOutput: `Error: ${err.message}`,
                });

                // On error, try to continue unless it's catastrophic
                if (loopIndex >= 3 && steps.slice(-3).every(s => s.toolOutput?.startsWith("Error:"))) {
                    this._status = "error";
                    opts?.onStatus?.("error");
                    broadcast({ type: "visual_loop_status", status: "error", error: err.message });
                    return {
                        status: "error",
                        steps,
                        totalLoops: loopIndex,
                        summary: `Failed after ${loopIndex} loops: ${err.message}`,
                        elapsedMs: Date.now() - startTime,
                    };
                }
            }
        }

        // Exited loop — either maxLoops or stopped
        const finalStatus: VisualLoopStatus = this._isStopped ? "stopped" : "max_loops";
        this._status = finalStatus;
        opts?.onStatus?.(finalStatus);
        broadcast({ type: "visual_loop_status", status: finalStatus });
        log.info(`Loop ended: ${finalStatus} after ${loopIndex} iterations`);

        return {
            status: finalStatus,
            steps,
            totalLoops: loopIndex,
            summary: this._isStopped
                ? "Loop stopped by user."
                : `Reached maximum loops (${maxLoops}) without completing the task.`,
            elapsedMs: Date.now() - startTime,
        };
    }

    /**
     * Call the VLM with screenshot. Uses Gemini multimodal directly if available,
     * falls back to text-only description via generateText().
     */
    private async _callVLM(
        systemPrompt: string,
        history: ChatMessage[],
        screenshotB64: string,
        display: DisplayInfo,
    ): Promise<string> {
        // Try Gemini multimodal first (supports inline image data)
        const apiKey = process.env.GEMINI_API_KEY;
        if (apiKey) {
            try {
                return await this._callGeminiVision(
                    apiKey, systemPrompt, history, screenshotB64, display,
                );
            } catch (e: any) {
                log.warn(`Gemini vision failed, falling back to text: ${e.message}`);
            }
        }

        // Fallback: text-only — describe the screenshot request
        const textMessages: ChatMessage[] = [
            ...history,
            {
                role: "user",
                content: `[A screenshot of the desktop (${display.logicalWidth}x${display.logicalHeight}) was taken. I cannot show it to you directly. Based on the task and previous actions, decide what to do next. If you need to see the screen, output: Action: wait()]`,
            },
        ];
        const result = await generateText({
            systemPrompt,
            messages: textMessages,
            temperature: 0.2,
            maxTokens: 1000,
        });
        return result.text;
    }

    /**
     * Call Gemini with vision (multimodal) using @google/genai directly.
     */
    private async _callGeminiVision(
        apiKey: string,
        systemPrompt: string,
        history: ChatMessage[],
        screenshotB64: string,
        display: DisplayInfo,
    ): Promise<string> {
        const { GoogleGenAI } = await import("@google/genai");
        const ai = new GoogleGenAI({ apiKey });

        // Build contents array: system instruction + history + current screenshot
        const contents: any[] = [];

        // Convert history to Gemini format
        for (const msg of history) {
            if (msg.role === "system") continue; // handled via systemInstruction
            contents.push({
                role: msg.role === "assistant" ? "model" : "user",
                parts: [{ text: msg.content }],
            });
        }

        // Add current screenshot as the last user message
        contents.push({
            role: "user",
            parts: [
                {
                    inlineData: {
                        mimeType: "image/png",
                        data: screenshotB64,
                    },
                },
                {
                    text: `This is a screenshot of the current screen (${display.logicalWidth}x${display.logicalHeight} logical pixels, ${display.physicalWidth}x${display.physicalHeight} physical). All coordinates in your Action must be in logical pixel space. What do you see and what should you do next?`,
                },
            ],
        });

        const response = await ai.models.generateContent({
            model: "gemini-2.5-flash",
            config: {
                systemInstruction: systemPrompt,
                temperature: 0.2,
                maxOutputTokens: 1000,
            },
            contents,
        });

        return response.text || "Action: wait()";
    }
}

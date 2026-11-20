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

import { captureDesktopPng, pngDimensions } from "../actions/screenshot.js";
import { analyzeImage } from "../providers/vision.js";
import { createLogger } from "../infra/logger.js";
import { raceWithAbortSignal } from "../infra/race-abort.js";
import { getToolFailure, OrbitToolError } from "../core/orbit-error.js";
import { broadcast } from "../gateway/server.js";
import { getConfig } from "../config/config.js";
import { executeTool } from "../actions/index.js";
import { getScreenSize } from "../actions/ps-bridge.js";
import { setTimeout as delay } from "node:timers/promises";
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

async function captureScreenshot(signal?: AbortSignal): Promise<{ base64: string; display: DisplayInfo }> {
    const buffer = await captureDesktopPng();
    signal?.throwIfAborted();
    const base64 = buffer.toString("base64");
    const dims = pngDimensions(buffer);
    const [logW, logH] = await getScreenSize(signal);
    const physW = dims.width || logW;
    const physH = dims.height || logH;

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
async function executeVisualAction(action: VisualAction, signal?: AbortSignal): Promise<string> {
    signal?.throwIfAborted();
    switch (action.action) {
        case "click":
        case "double_click":
        case "right_click":
        case "type":
        case "hotkey":
        case "scroll":
        case "move":
            return executeTool("computer_control", action, signal);
        case "drag":
            return executeTool("drag", { from_x: action.x, from_y: action.y, to_x: action.endX, to_y: action.endY }, signal);
        case "wait":
            await delay(2000, undefined, { signal });
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
    private _controller?: AbortController;
    private _pauseRevision = 0;
    private _pausePromise: Promise<void> | null = null;
    private _resumeResolve: (() => void) | null = null;

    get status(): VisualLoopStatus { return this._status; }

    /** Pause the loop — blocks at next iteration until resume() is called. */
    pause(): void {
        if (this._status !== "running" || this._controller?.signal.aborted) return;
        this._isPaused = true;
        this._pauseRevision++;
        this._pausePromise = new Promise(r => { this._resumeResolve = r; });
        this._status = "paused";
        log.info("Loop paused");
        broadcast({ type: "visual_loop_status", status: "paused" });
    }

    /** Resume a paused loop. */
    resume(): void {
        if (!this._isPaused) return;
        this.releasePause();
        this._status = "running";
        log.info("Loop resumed");
        broadcast({ type: "visual_loop_status", status: "running" });
    }

    private releasePause(): void {
        this._isPaused = false;
        this._resumeResolve?.();
        this._resumeResolve = null;
        this._pausePromise = null;
    }

    /** Stop the loop cleanly after the current step completes. */
    stop(): void {
        this._controller?.abort(new Error("Se detuvo la tarea visual."));
        this.releasePause();
    }

    /**
     * Run the autonomous visual loop for a given goal.
     *
     * Loop: screenshot → LLM → parseAction → execute → repeat
     * Terminates on: finished(), call_user(), maxLoops, stop(), error.
     */
    async run(goal: string, opts?: VisualLoopOptions): Promise<VisualLoopResult> {
        const cfg = getConfig().agent;
        const requested = opts?.maxLoops ?? cfg.maxVisualLoops;
        if (!Number.isInteger(requested) || requested < 1) throw new Error("Indica al menos un paso visual.");
        const maxLoops = Math.min(requested, cfg.maxVisualLoops);
        if (this._controller) throw new Error("Ya hay una tarea en este agente visual.");
        const controller = new AbortController();
        const signal = opts?.signal ? AbortSignal.any([controller.signal, opts.signal]) : controller.signal;
        signal.throwIfAborted();
        this._controller = controller;
        const startTime = Date.now();
        const steps: VisualLoopStep[] = [];
        const messages: ChatMessage[] = [];

        this._status = "running";
        opts?.onStatus?.("running");
        broadcast({ type: "visual_loop_status", status: "running", goal });

        // Initial user message with the goal
        messages.push({ role: "user", content: `TASK: ${goal}` });

        log.info(`Visual loop started — goal: "${goal.slice(0, 80)}" maxLoops: ${maxLoops}`);

        let loopIndex = 0;
        let consecutiveFailures = 0;
        const finish = (status: VisualLoopStatus, summary: string): VisualLoopResult => {
            this._controller = undefined;
            this.releasePause();
            this._status = status;
            opts?.onStatus?.(status);
            broadcast({ type: "visual_loop_status", status, result: summary });
            return { status, steps, totalLoops: loopIndex, summary, elapsedMs: Date.now() - startTime };
        };

        while (loopIndex < maxLoops && !signal.aborted) {
            const stepStart = Date.now();
            try {
                while (this._pausePromise) await raceWithAbortSignal(this._pausePromise, signal);
                signal.throwIfAborted();
                const revision = this._pauseRevision;
                loopIndex++;
                const { base64, display } = await captureScreenshot(signal);
                if (revision !== this._pauseRevision) continue;
                const systemPrompt = buildVisualSystemPrompt(display.logicalWidth, display.logicalHeight);
                const vlmResponse = await this._callVLM(systemPrompt, messages, base64, display, signal);
                signal.throwIfAborted();
                if (revision !== this._pauseRevision) continue;

                // 3. Parse action
                const action = parseVisualAction(vlmResponse);
                log.info(`Step ${loopIndex}: Thought="${(action.thought || "").slice(0, 80)}" Action=${action.action}`);

                // 4. Execute action
                const toolOutput = await executeVisualAction(action, signal);
                signal.throwIfAborted();
                const failure = getToolFailure(toolOutput);
                if (failure) throw failure;
                consecutiveFailures = 0;

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
                    return finish("finished", action.result || "Tarea visual completada.");
                }

                if (action.action === "call_user") {
                    return finish("call_user", action.result || "Orbit necesita que intervengas.");
                }

            } catch (error) {
                if (signal.aborted) break;
                const message = error instanceof Error ? error.message : String(error);
                log.error(`Paso visual ${loopIndex}: ${message}`);
                steps.push({
                    loopIndex,
                    action: { action: "wait" },
                    startedAt: stepStart,
                    durationMs: Date.now() - stepStart,
                    toolOutput: `Error: ${message}`,
                });
                if ((error instanceof OrbitToolError && error.code === "PERMISSION_DENIED") || ++consecutiveFailures >= 3) {
                    return finish("error", message);
                }
            }
        }

        if (signal.aborted) return finish("stopped", "Tarea visual detenida.");
        if (consecutiveFailures === loopIndex) return finish("error", steps.at(-1)?.toolOutput || "Falló la tarea visual.");
        return finish("max_loops", `Se alcanzó el límite de ${maxLoops} pasos visuales.`);
    }

    private async _callVLM(
        systemPrompt: string,
        history: ChatMessage[],
        screenshotB64: string,
        display: DisplayInfo,
        signal?: AbortSignal,
    ): Promise<string> {
        const size = display.logicalWidth + "x" + display.logicalHeight;
        const request = "La imagen muestra la pantalla actual. Usa coordenadas de pantalla de " + size +
            " píxeles lógicos. Describe lo que ves y decide el siguiente paso.";
        return await analyzeImage({ mimeType: "image/png", data: screenshotB64 }, {
            systemPrompt,
            messages: [...history, { role: "user", content: request }],
            temperature: 0.2,
            maxTokens: 1000,
            signal,
        }) || "Action: wait()";
    }
}

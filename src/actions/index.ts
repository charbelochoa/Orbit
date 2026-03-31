import { browserControl }   from "./browser-control.js";
import { computerControl }  from "./computer-control.js";
import { computerSettings } from "./computer-settings.js";
import { cmdControl }       from "./cmd-control.js";
import { fileController }   from "./file-controller.js";
import { screenVision }     from "./screen-vision.js";
import { webSearch, weatherReport } from "./web-search.js";
import { visionDetect, visionClick, visionType, visionStatus } from "./vision-control.js";
import { screenFind, clickElement, drag, screenContext } from "./screen-interaction.js";
import { openApp }          from "./open-app.js";
import { codeHelper }       from "./code-helper.js";
import { sendMessage }      from "./send-message.js";
import { reminder }         from "./reminder.js";
import { toolRegistry }     from "../core/registry.js";
import { policyEngine }     from "../core/tool-policy.js";
import { createLogger }     from "../infra/logger.js";
import { subagentRegistry } from "../agent/subagent-registry.js";

const log = createLogger("ToolRouter");

/**
 * Central tool router — maps every tool name Gemini can call to its handler.
 * Phase 1: validates tool existence + policy before dispatch.
 */
export async function executeTool(name: string, args: any): Promise<string> {
    // Phase 1: Tool validation
    if (!toolRegistry.has(name) && name !== "screen_process") {
        log.warn(`Tool desconocida: '${name}'`);
        return `Tool '${name}' no esta implementada.`;
    }

    // Phase 1.3: Policy check
    const policy = policyEngine.evaluate(name);
    if (policy.action === "deny") {
        log.warn(`Tool '${name}' bloqueada: ${policy.reason}`);
        return `Tool '${name}' no permitida: ${policy.reason || "politica de seguridad"}`;
    }

    log.info(name, args);
    try { switch (name) { 
//  ── Browser ──────────────────────────────────────────────────
case "browser_control": return await browserControl(args);
    //  ── Computer control (mouse/keyboard via PowerShell) ──────────
case "computer_control": return await computerControl(args);
    //  ── Computer settings (volume, brightness, windows) ──────────
case "computer_settings": return await computerSettings(args);
    //  ── Open applications ─────────────────────────────────────────
case "open_app": return await openApp(args);
    //  ── Shell / System commands ───────────────────────────────────
case "cmd_control": return await cmdControl(args);
    //  ── File system ───────────────────────────────────────────────
case "file_controller": return await fileController(args);
    //  ── Screen vision (Gemini multimodal screenshot analysis) ─────
case "screen_vision": case "screen_process": return await screenVision(args);
    //  ── YOLO Vision Engine (orbit_master_v1.pt) ───────────────────
case "vision_detect": return await visionDetect(args);
    case "vision_click": return await visionClick(args);
    case "vision_type": return await visionType(args);
    case "vision_status": return await visionStatus();
    //  ── Web search ────────────────────────────────────────────────
case "web_search": return await webSearch(args);
    //  ── Weather ───────────────────────────────────────────────────
case "weather_report": return await weatherReport(args);
    //  ── Code helper (write/run/fix/explain code) ──────────────────
case "code_helper": return await codeHelper(args);
    //  ── Send message (WhatsApp/Telegram) ──────────────────────────
case "send_message": return await sendMessage(args);
    //  ── Reminders (Windows Task Scheduler) ────────────────────────
case "reminder": return await reminder(args);
    //  ── Screen interaction (Gemini Vision + mouse) ────────────────
case "screen_find": return await screenFind(args);
    case "click_element": return await clickElement(args);
    case "drag": return await drag(args);
    case "screen_context": return await screenContext(args);
    //  ── Agent task (enqueued via task-queue in index.ts) ──────────
case "agent_task": return "Tarea encolada en el Task Queue. Te avisare cuando termine.";
    //  ── Spawn subagent (Phase 4.1) ────────────────────────────────
case "spawn_subagent": {
        const subId = await subagentRegistry.spawn({
            goal:            args.goal || "",
            parentSessionId: args.parentSessionId || "main",
            toolProfile:     args.toolProfile,
            maxSteps:        args.maxSteps,
            timeoutMs:       args.timeoutMs,
            context:         args.context,
        });
        return `Subagente '${subId}' lanzado para: ${(args.goal || "").slice(0, 60)}`;
    }
    default: log.warn(`Tool desconocida: '${name}'`);
    return `Tool '${name}' no esta implementada.`;} }catch (error: any) { log.error(`Error en '${name}':`, error);
    return `Error ejecutando '${name}': ${error.message}`;
    }
}

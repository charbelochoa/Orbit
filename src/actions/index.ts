import { browserControl }   from "./browser-control.js";
import { computerControl }  from "./computer-control.js";
import { cmdControl }       from "./cmd-control.js";
import { fileController }   from "./file-controller.js";
import { screenVision }     from "./screen-vision.js";
import { webSearch, weatherReport } from "./web-search.js";
import { visionDetect, visionClick, visionType, visionStatus } from "./vision-control.js";

/**
 * Central tool router — maps every tool name Gemini can call to its handler.
 */
export async function executeTool(name: string, args: any): Promise<string> {
    console.log(`[Orbit Executor] 🔨 ${name}`, args);

    try {
        switch (name) {

            // ── Browser ──────────────────────────────────────────────────
            case "browser_control":
                return await browserControl(args);

            // ── Computer control (mouse/keyboard via PowerShell) ──────────
            case "computer_control":
            case "computer_settings":   // alias
                return await computerControl(args);

            // ── Shell / System commands ───────────────────────────────────
            case "cmd_control":
            case "open_app":
                return await cmdControl({ task: args.app_name ? `start "" "${args.app_name}"` : undefined, ...args });

            // ── File system ───────────────────────────────────────────────
            case "file_controller":
                return await fileController(args);

            // ── Screen vision (Gemini multimodal screenshot analysis) ─────
            case "screen_vision":
            case "screen_process":
                return await screenVision(args);

            // ── YOLO Vision Engine (orbit_master_v1.pt) ───────────────────
            case "vision_detect":
                return await visionDetect(args);

            case "vision_click":
                return await visionClick(args);

            case "vision_type":
                return await visionType(args);

            case "vision_status":
                return await visionStatus();

            // ── Web search ────────────────────────────────────────────────
            case "web_search":
                return await webSearch(args);

            // ── Weather ───────────────────────────────────────────────────
            case "weather_report":
                return await weatherReport(args);

            // ── Agent task (enqueued via task-queue in index.ts) ──────────
            case "agent_task":
                return "Tarea encolada en el Task Queue. Te avisaré cuando termine.";

            default:
                console.warn(`[Orbit Executor] ⚠️ Tool desconocida: '${name}'`);
                return `Tool '${name}' no está implementada. Tools disponibles: computer_control, browser_control, cmd_control, file_controller, screen_vision, vision_detect, vision_click, web_search, weather_report.`;
        }
    } catch (error: any) {
        console.error(`[Orbit Executor] ❌ Error en '${name}':`, error);
        return `Error ejecutando '${name}': ${error.message}`;
    }
}

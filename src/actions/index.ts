import { browserControl }   from "./browser-control.js";
import { computerControl }  from "./computer-control.js";
import { computerSettings } from "./computer-settings.js";
import { cmdControl }       from "./cmd-control.js";
import { fileController }   from "./file-controller.js";
import { fileEdit }         from "./file-edit.js";
import { globTool }         from "./glob-tool.js";
import { grepTool }         from "./grep-tool.js";
import { screenVision }     from "./screen-vision.js";
import { webSearch, weatherReport, webFetch } from "./web-search.js";
import { todoRead, todoWrite } from "./todo-tool.js";
import { taskCreate, taskGet, taskList, taskStop, taskOutput } from "./task-tools.js";
import { visionDetect, visionClick, visionType, visionStatus } from "./vision-control.js";
import { screenFind, clickElement, drag, screenContext } from "./screen-interaction.js";
import { openApp }          from "./open-app.js";
import { codeHelper }       from "./code-helper.js";
import { sendMessage }      from "./send-message.js";
import { reminder }         from "./reminder.js";
import { toolRegistry }     from "../core/registry.js";
import { policyEngine }     from "../core/tool-policy.js";
import { requestPermission } from "../core/permission-broker.js";
import { isPlanMode, logPlannedStep } from "../agent/plan-mode.js";
import { createLogger }     from "../infra/logger.js";
import { subagentRegistry } from "../agent/subagent-registry.js";
import { runSwarm }               from "../agent/swarm.js";
import { captureScreenMemory }    from "./capture-screen-memory.js";
import { rpaRecord }              from "./rpa-recorder.js";
import { mcpRegistry }            from "../mcp/registry.js";
import { runPreToolHooks, runPostToolHooks } from "../hooks/runner.js";
import { getAmbientContext }      from "./ambient-context.js";
import { calendarCheck }          from "./calendar.js";
import { emailRead }              from "./email.js";
import { assembleBriefing }       from "../briefing/assembler.js";
import { getMoodContext }          from "./mood-context.js";
import { codebaseSearch }          from "./codebase.js";

const log = createLogger("ToolRouter");

/**
 * Central tool router — maps every tool name Gemini can call to its handler.
 * Phase 1: validates tool existence + policy before dispatch.
 * Phase 6: PreToolUse / PostToolUse lifecycle hooks.
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

    // Sprint 8: Interactive permission dialog for "ask" policy
    if (policy.action === "ask") {
        const argsStr = Object.entries(args || {})
            .slice(0, 3)
            .map(([k, v]) => `${k}=${String(v).slice(0, 40)}`)
            .join(", ");
        const desc = policy.reason || `La herramienta '${name}' quiere ejecutarse${argsStr ? ` con: ${argsStr}` : ""}.`;
        const answer = await requestPermission(name, args || {}, desc);
        if (answer === "deny") {
            log.info(`Permiso denegado por el usuario para '${name}'`);
            return `El usuario denegó la ejecución de '${name}'.`;
        }
        // answer=="allow" or "always": continue ("always" already persisted in broker)
    }

    // Sprint 8: Plan Mode intercept — record step instead of executing
    if (isPlanMode()) {
        const idx = logPlannedStep(name, args || {});
        log.info(`[Plan Mode] Paso ${idx} registrado: ${name}`);
        return `[Plan Mode] Paso ${idx} registrado: \`${name}\`. Usa \`/plan show\` para ver el plan y \`/plan execute\` para ejecutarlo.`;
    }

    // Phase 6: PreToolUse hooks — can block execution
    const preHook = await runPreToolHooks(name, args || {});
    if (preHook.blocked) {
        log.warn(`Tool '${name}' bloqueada por hook: ${preHook.reason}`);
        return `Tool '${name}' bloqueada por hook PreToolUse: ${preHook.reason}`;
    }

    log.info(name, args);
    let result: string;
    try { switch (name) { 
//  ── Browser ──────────────────────────────────────────────────
case "browser_control": result = await browserControl(args); break;
    //  ── Computer control (mouse/keyboard via PowerShell) ──────────
case "computer_control": result = await computerControl(args); break;
    //  ── Computer settings (volume, brightness, windows) ──────────
case "computer_settings": result = await computerSettings(args); break;
    //  ── Open applications ─────────────────────────────────────────
case "open_app": result = await openApp(args); break;
    //  ── Shell / System commands ───────────────────────────────────
case "cmd_control": result = await cmdControl(args); break;
    //  ── File system ───────────────────────────────────────────────
case "file_controller": result = await fileController(args); break;
    //  ── Screen vision (Gemini multimodal screenshot analysis) ─────
case "screen_vision": case "screen_process": result = await screenVision(args); break;
    //  ── Visual Memory (Sprint 6) ──────────────────────────────────
case "capture_screen_memory": result = await captureScreenMemory(args); break;
    //  ── RPA Recorder (Sprint 7) ───────────────────────────────
case "rpa_record": result = await rpaRecord(args); break;
    //  ── YOLO Vision Engine (orbit_master_v1.pt) ───────────────────
case "vision_detect": result = await visionDetect(args); break;
    case "vision_click": result = await visionClick(args); break;
    case "vision_type": result = await visionType(args); break;
    case "vision_status": result = await visionStatus(); break;
    //  ── Web search ────────────────────────────────────────────────
case "web_search": result = await webSearch(args); break;
    //  ── Weather ───────────────────────────────────────────────────
case "weather_report": result = await weatherReport(args); break;
    //  ── Code helper (write/run/fix/explain code) ──────────────────
case "code_helper": result = await codeHelper(args); break;
    //  ── Send message (WhatsApp/Telegram) ──────────────────────────
case "send_message": result = await sendMessage(args); break;
    //  ── Reminders (Windows Task Scheduler) ────────────────────────
case "reminder": result = await reminder(args); break;
    //  ── Screen interaction (Gemini Vision + mouse) ────────────────
case "screen_find": result = await screenFind(args); break;
    case "click_element": result = await clickElement(args); break;
    case "drag": result = await drag(args); break;
    case "screen_context": result = await screenContext(args); break;
    //  ── Agent task (enqueued via task-queue in index.ts) ──────────
case "agent_task": result = "Tarea encolada en el Task Queue. Te avisare cuando termine."; break;
    //  ── Run Swarm (Sprint 5) ────────────────────────────────────
case "run_swarm": {
        const tasks = args.tasks || [];
        const swarmResult = await runSwarm(tasks, {
            name:        args.name,
            sessionId:   args.sessionId,
            timeoutMs:   args.timeoutMs,
            concurrency: args.concurrency,
        });
        result = swarmResult.summary;
        break;
    }
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
        result = `Subagente '${subId}' lanzado para: ${(args.goal || "").slice(0, 60)}`;
        break;
    }
    //  ── Phase 3: New tools ────────────────────────────────────────
case "file_edit": result = await fileEdit(args); break;
    case "glob_search": result = await globTool(args); break;
    case "grep_search": result = await grepTool(args); break;
    case "web_fetch": result = await webFetch(args); break;
    case "todo_read": result = await todoRead(); break;
    case "todo_write": result = await todoWrite(args); break;
    //  ── Phase 7: Task API ─────────────────────────────────────────
case "task_create": result = await taskCreate(args); break;
    case "task_get": result = await taskGet(args); break;
    case "task_list": result = await taskList(); break;
    case "task_stop": result = await taskStop(args); break;
    case "task_output": result = await taskOutput(args); break;
    case "mcp_call": {
        const toolName = args.tool || "";
        const toolArgs = args.args || {};
        if (args.server) {
            const mcpOut = await mcpRegistry.callTool(args.server, toolName, toolArgs);
            result = typeof mcpOut === "string" ? mcpOut : JSON.stringify(mcpOut, null, 2);
        } else {
            const mcpOut = await mcpRegistry.callToolByName(toolName, toolArgs);
            result = typeof mcpOut === "string" ? mcpOut : JSON.stringify(mcpOut, null, 2);
        }
        break;
    }
    //  ── Ambient / Calendar / Email / Briefing (Sprints 9-10) ──────
case "get_ambient_context": result = await getAmbientContext(args); break;
    case "calendar_check": result = await calendarCheck(args); break;
    case "email_read": result = await emailRead(args); break;
    case "get_briefing": result = await assembleBriefing(args.type || "morning"); break;
    //  ── Mood / Pattern Context (Sprint 11) ────────────────────────
case "get_mood_context": result = await getMoodContext(args); break;
    //  ── Codebase Semantic Index (Sprint 13) ─────────────────────────────────────────
case "codebase_search": result = await codebaseSearch(args); break;
    default: log.warn(`Tool desconocida: '${name}'`);
    result = `Tool '${name}' no esta implementada.`;
    // Phase 6: PostToolUse hooks (unknown tool)
    await runPostToolHooks(name, args || {}, result, false).catch(() => {});
    return result;
    }

    // Phase 6: PostToolUse hooks (success)
    await runPostToolHooks(name, args || {}, result!, true).catch(() => {});
    return result!;
    } catch (error: any) { log.error(`Error en '${name}':`, error);
    result = `Error ejecutando '${name}': ${error.message}`;
    // Phase 6: PostToolUse hooks (failure)
    await runPostToolHooks(name, args || {}, result, false).catch(() => {});
    return result;
    }
}

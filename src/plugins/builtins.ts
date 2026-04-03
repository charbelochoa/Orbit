/**
 * Orbit Built-in Plugins
 * Phase 3.3 — Each action group becomes a typed tool plugin.
 * The plugin wraps the existing action implementation, preserving all behavior.
 */

import { pluginRegistry } from "./registry.js";
import { toolRegistry }   from "../core/registry.js";
import type { OrbitToolPlugin } from "./types.js";
import type { OrbitTool } from "../core/registry.js";
import { createLogger } from "../infra/logger.js";

// ── Base class for action-backed tool plugins ────────────────────────────────

const log = createLogger("plugins");

abstract class ActionPlugin implements OrbitToolPlugin {
    abstract id:          string;
    abstract name:        string;
    abstract version:     string;
    abstract description: string;
    readonly type = "tool" as const;
    private _ready = false;

    async setup(): Promise<void> { this._ready = true; }
    async teardown(): Promise<void> { this._ready = false; }
    isReady(): boolean { return this._ready; }

    /** Return OrbitTool objects owned by this plugin */
    getTools(): OrbitTool[] {
        return this.toolIds.map(id => toolRegistry.get(id)).filter(Boolean) as OrbitTool[];
    }

    /** Tool IDs this plugin is responsible for */
    abstract get toolIds(): string[];

    /** Delegate execution to the existing action handler */
    async execute(toolId: string, args: any): Promise<string> {
        const { executeTool } = await import("../actions/index.js");
        return executeTool(toolId, args);
    }
}

// ── Built-in plugin definitions ───────────────────────────────────────────────

class BrowserPlugin extends ActionPlugin {
    id = "browser"; name = "Browser Control"; version = "1.0.0";
    description = "Puppeteer-based browser automation: navigate, click, type, scrape.";
    get toolIds() { return ["browser_control"]; }
}

class ComputerPlugin extends ActionPlugin {
    id = "computer"; name = "Computer Control"; version = "1.0.0";
    description = "Mouse, keyboard, window management via PowerShell bridge.";
    get toolIds() { return ["computer_control", "computer_settings", "open_app", "cmd_control", "drag"]; }
}

class VisionPlugin extends ActionPlugin {
    id = "vision"; name = "Vision Engine"; version = "1.0.0";
    description = "Screen analysis via Gemini Vision + YOLO element detection.";
    get toolIds() {
        return [
            "screen_vision", "screen_find", "screen_context",
            "click_element", "vision_detect", "vision_click",
            "vision_type", "vision_status",
        ];
    }
}

class FilesPlugin extends ActionPlugin {
    id = "files"; name = "File System"; version = "1.0.0";
    description = "File and folder operations: read, write, copy, move, search.";
    get toolIds() { return ["file_controller"]; }
}

class WebPlugin extends ActionPlugin {
    id = "web"; name = "Web & Search"; version = "1.0.0";
    description = "Web search and weather report via network APIs.";
    get toolIds() { return ["web_search", "weather_report"]; }
}

class CodingPlugin extends ActionPlugin {
    id = "coding"; name = "Code Helper"; version = "1.0.0";
    description = "Generate, run, fix, and explain code in multiple languages.";
    get toolIds() { return ["code_helper"]; }
}

class MessagingPlugin extends ActionPlugin {
    id = "messaging"; name = "Messaging"; version = "1.0.0";
    description = "Send messages via WhatsApp Web and Telegram Web.";
    get toolIds() { return ["send_message"]; }
}

class SchedulerPlugin extends ActionPlugin {
    id = "scheduler"; name = "Scheduler"; version = "1.0.0";
    description = "Windows Task Scheduler reminders.";
    get toolIds() { return ["reminder"]; }
}

class AgentPlugin extends ActionPlugin {
    id = "agent"; name = "Agent Task"; version = "1.0.0";
    description = "Multi-step autonomous planning and execution.";
    get toolIds() { return ["agent_task", "spawn_subagent"]; }
}

// ── Registration ──────────────────────────────────────────────────────────────

export async function registerBuiltinPlugins(): Promise<void> {
    const builtins: ActionPlugin[] = [
        new BrowserPlugin(),
        new ComputerPlugin(),
        new VisionPlugin(),
        new FilesPlugin(),
        new WebPlugin(),
        new CodingPlugin(),
        new MessagingPlugin(),
        new SchedulerPlugin(),
        new AgentPlugin(),
    ];

    for (const plugin of builtins) {
        await pluginRegistry.register(plugin);
    }
}

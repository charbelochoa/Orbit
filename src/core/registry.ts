/**
 * Orbit Typed Tool Registry
 * Phase 1.1 + 1.2 — Wraps existing TOOL_DECLARATIONS with section, profile, and capability metadata.
 * Provides the same TOOL_DECLARATIONS export for backward compat with Gemini Live API.
 */

import { TOOL_DECLARATIONS } from "./tool-registry.js";

// ── Types ────────────────────────────────────────────────────────────────────

export type ToolSection  = "system" | "web" | "files" | "ai" | "comms" | "agent" | "vision";
export type ToolProfile  = "minimal" | "standard" | "coding" | "full";

export interface ToolCapabilities {
    requiresUI?:      boolean;
    requiresNetwork?: boolean;
    destructive?:     boolean;
    async?:           boolean;
    requiresPython?:  boolean;
}

export interface OrbitTool {
    id:           string;
    section:      ToolSection;
    profiles:     ToolProfile[];
    description:  string;
    parameters:   Record<string, any>;
    capabilities: ToolCapabilities;
}

// ── Metadata for each built-in tool ──────────────────────────────────────────

type ToolMeta = { section: ToolSection; profiles: ToolProfile[]; capabilities: ToolCapabilities };

const TOOL_METADATA: Record<string, ToolMeta> = {
    // System
    open_app:           { section: "system",  profiles: ["minimal","standard","coding","full"], capabilities: {} },
    computer_settings:  { section: "system",  profiles: ["standard","coding","full"],           capabilities: { requiresUI: true } },
    computer_control:   { section: "system",  profiles: ["standard","coding","full"],           capabilities: { requiresUI: true } },
    cmd_control:        { section: "system",  profiles: ["coding","full"],                      capabilities: { destructive: true } },
    reminder:           { section: "system",  profiles: ["standard","full"],                    capabilities: {} },
    drag:               { section: "system",  profiles: ["standard","full"],                    capabilities: { requiresUI: true } },

    // Web
    web_search:         { section: "web",     profiles: ["minimal","standard","coding","full"], capabilities: { requiresNetwork: true } },
    weather_report:     { section: "web",     profiles: ["minimal","standard","full"],          capabilities: { requiresNetwork: true } },
    browser_control:    { section: "web",     profiles: ["standard","coding","full"],           capabilities: { requiresNetwork: true } },

    // Files
    file_controller:    { section: "files",   profiles: ["minimal","standard","coding","full"], capabilities: {} },

    // AI
    code_helper:        { section: "ai",      profiles: ["coding","full"],                     capabilities: {} },

    // Comms
    send_message:       { section: "comms",   profiles: ["standard","full"],                   capabilities: { requiresNetwork: true } },

    // Vision
    screen_vision:      { section: "vision",  profiles: ["standard","full"],                   capabilities: { requiresUI: true } },
    vision_detect:      { section: "vision",  profiles: ["standard","full"],                   capabilities: { requiresUI: true, requiresPython: true } },
    vision_click:       { section: "vision",  profiles: ["standard","full"],                   capabilities: { requiresUI: true, requiresPython: true } },
    vision_type:        { section: "vision",  profiles: ["standard","full"],                   capabilities: { requiresUI: true, requiresPython: true } },
    vision_status:      { section: "vision",  profiles: ["full"],                              capabilities: { requiresPython: true } },
    screen_find:        { section: "vision",  profiles: ["standard","full"],                   capabilities: { requiresUI: true } },
    click_element:      { section: "vision",  profiles: ["standard","full"],                   capabilities: { requiresUI: true } },
    screen_context:     { section: "vision",  profiles: ["standard","full"],                   capabilities: { requiresUI: true } },

    // Agent
    agent_task:         { section: "agent",   profiles: ["standard","coding","full"],           capabilities: { async: true } },
    spawn_subagent:     { section: "agent",   profiles: ["standard","coding","full"],           capabilities: { async: true } },
};

// ── Registry Class ───────────────────────────────────────────────────────────

class ToolRegistryClass {
    private tools = new Map<string, OrbitTool>();

    register(tool: OrbitTool): void {
        this.tools.set(tool.id, tool);
    }

    get(id: string): OrbitTool | undefined {
        return this.tools.get(id);
    }

    has(id: string): boolean {
        return this.tools.has(id);
    }

    getAll(): OrbitTool[] {
        return Array.from(this.tools.values());
    }

    getBySection(section: ToolSection): OrbitTool[] {
        return this.getAll().filter(t => t.section === section);
    }

    getByProfile(profile: ToolProfile): OrbitTool[] {
        return this.getAll().filter(t => t.profiles.includes(profile));
    }

    /** Convert to Gemini functionDeclarations format, optionally filtered by profile */
    toGeminiDeclarations(profile?: ToolProfile): any[] {
        const tools = profile ? this.getByProfile(profile) : this.getAll();
        return tools.map(t => ({
            name: t.id,
            description: t.description,
            parameters: t.parameters,
        }));
    }

    get count(): number {
        return this.tools.size;
    }
}

// ── Singleton ────────────────────────────────────────────────────────────────

export const toolRegistry = new ToolRegistryClass();

// Register all built-in tools from existing declarations
for (const decl of TOOL_DECLARATIONS) {
    const meta = TOOL_METADATA[decl.name] || {
        section: "system" as ToolSection,
        profiles: ["full"] as ToolProfile[],
        capabilities: {},
    };
    toolRegistry.register({
        id:           decl.name,
        section:      meta.section,
        profiles:     meta.profiles,
        description:  decl.description,
        parameters:   decl.parameters,
        capabilities: meta.capabilities,
    });
}

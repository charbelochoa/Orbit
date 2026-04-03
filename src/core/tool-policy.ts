/**
 * Orbit Tool Policy Engine — Phase 4
 * Layered permission system with wildcards, protected paths, and persistent settings.
 *
 * Priority (highest to lowest):
 *  1. policy     — hardcoded system protections (never overridable)
 *  2. user       — ~/.orbit/settings.json
 *  3. project    — .orbit/settings.json  (commitable)
 *  4. local      — .orbit/settings.local.json  (gitignored)
 *  5. session    — in-memory (resets when orbit closes)
 *  6. default    — everything allowed
 */

import fs from "fs";
import path from "path";
import os from "os";
import { createLogger } from "../infra/logger.js";
import type { OrbitTool } from "./registry.js";

const log = createLogger("ToolPolicy");

// ── Types ────────────────────────────────────────────────────────────────────

export type PolicyAction = "allow" | "deny" | "ask";

export interface ToolPolicy {
    toolId:   string;       // tool id, or wildcard pattern like "Bash(git *)"
    action:   PolicyAction;
    reason?:  string;
}

export interface PolicyLayer {
    name:     string;
    priority: number;     // higher = more authority
    rules:    ToolPolicy[];
}

// ── Protected paths (Phase 4.2) ──────────────────────────────────────────────

const PROTECTED_FILES = new Set([
    ".gitconfig", ".bashrc", ".zshrc", ".profile", ".bash_profile",
    ".env", ".env.local", ".env.production",
    ".orbit/settings.json",
    ".ssh/config", ".ssh/id_rsa", ".ssh/id_ed25519",
    ".npmrc", ".pypirc",
]);

const PROTECTED_DIRS = new Set([
    ".git", ".orbit", "node_modules",
    ".ssh", ".gnupg", ".config",
]);

/**
 * Check if a file path is protected by system policy.
 * Returns the reason if protected, null if not.
 */
export function isProtectedPath(filePath: string): string | null {
    const normalized = filePath.replace(/\\/g, "/");
    const basename = path.basename(normalized);
    const relative = path.isAbsolute(normalized)
        ? path.relative(process.cwd(), normalized).replace(/\\/g, "/")
        : normalized;

    // Check exact protected files
    if (PROTECTED_FILES.has(basename) || PROTECTED_FILES.has(relative)) {
        return `Archivo protegido: ${basename}`;
    }

    // Check protected directories
    const parts = relative.split("/");
    for (const dir of PROTECTED_DIRS) {
        if (parts.includes(dir)) {
            return `Directorio protegido: ${dir}`;
        }
    }

    // Prevent writes outside the project root
    if (relative.startsWith("..")) {
        return "Escritura fuera del directorio del proyecto";
    }

    return null;
}

// ── Wildcard matching (Phase 4.3) ────────────────────────────────────────────

/**
 * Match a tool invocation against a wildcard rule.
 * Patterns:  "Bash(git *)"  "file_write(src/**)"  "file_write(*.env)"
 */
function matchesWildcard(ruleId: string, toolId: string, args?: Record<string, any>): boolean {
    // Exact match
    if (ruleId === toolId || ruleId === "*") return true;

    // Pattern match: "ToolName(argPattern)"
    const m = ruleId.match(/^(\w+)\((.+)\)$/);
    if (!m) return ruleId === toolId;

    const [, ruleTool, argPattern] = m;
    if (ruleTool !== toolId && ruleTool !== "*") return false;

    // Match the argument pattern against the first string argument
    if (!args) return false;
    const argVal = args.command || args.file_path || args.path || args.task || args.url || "";
    if (!argVal) return false;

    return wildcardMatch(argPattern, argVal);
}

function wildcardMatch(pattern: string, value: string): boolean {
    // Convert glob-like pattern to regex
    const re = pattern
        .replace(/[.+^${}()|[\]\\]/g, "\\$&")
        .replace(/\*\*/g, "§§")
        .replace(/\*/g, "[^/\\\\]*")
        .replace(/§§/g, ".*")
        .replace(/\?/g, ".");
    return new RegExp(`^${re}$`, "i").test(value);
}

// ── Settings loader (Phase 4.1) ──────────────────────────────────────────────

interface SettingsFile {
    allow?: string[];
    deny?:  string[];
    ask?:   string[];
}

function loadSettingsFile(filePath: string): ToolPolicy[] {
    if (!fs.existsSync(filePath)) return [];
    try {
        const raw = fs.readFileSync(filePath, "utf-8");
        const settings: SettingsFile = JSON.parse(raw);
        const rules: ToolPolicy[] = [];

        for (const id of settings.allow || []) {
            rules.push({ toolId: id, action: "allow" });
        }
        for (const id of settings.deny || []) {
            rules.push({ toolId: id, action: "deny" });
        }
        for (const id of settings.ask || []) {
            rules.push({ toolId: id, action: "ask" });
        }

        return rules;
    } catch (e) {
        log.warn(`Error loading settings ${filePath}: ${e}`);
        return [];
    }
}

// ── Engine ───────────────────────────────────────────────────────────────────

class ToolPolicyEngine {
    private layers: PolicyLayer[] = [];

    addLayer(layer: PolicyLayer): void {
        // Replace existing layer with same name
        this.layers = this.layers.filter(l => l.name !== layer.name);
        this.layers.push(layer);
        this.layers.sort((a, b) => b.priority - a.priority);
    }

    removeLayer(name: string): void {
        this.layers = this.layers.filter(l => l.name !== name);
    }

    /** Add a session-level rule (persists until restart) */
    addSessionRule(rule: ToolPolicy): void {
        const session = this.layers.find(l => l.name === "session");
        if (session) {
            // Remove existing rule for same toolId
            session.rules = session.rules.filter(r => r.toolId !== rule.toolId);
            session.rules.push(rule);
        }
    }

    /** Remove all local rules for a toolId (clear) */
    removeLocalRule(toolId: string): void {
        const dir      = path.join(process.cwd(), ".orbit");
        const filePath = path.join(dir, "settings.local.json");
        if (!fs.existsSync(filePath)) return;
        let settings: SettingsFile = {};
        try { settings = JSON.parse(fs.readFileSync(filePath, "utf-8")); } catch { return; }
        settings.allow = (settings.allow || []).filter(id => id !== toolId);
        settings.deny  = (settings.deny  || []).filter(id => id !== toolId);
        settings.ask   = (settings.ask   || []).filter(id => id !== toolId);
        fs.writeFileSync(filePath, JSON.stringify(settings, null, 2));
        this.loadConfigLayers();
    }

    /** Save a rule to a local settings file */
    saveLocalRule(toolId: string, action: PolicyAction): void {
        const dir = path.join(process.cwd(), ".orbit");
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        const filePath = path.join(dir, "settings.local.json");

        let settings: SettingsFile = {};
        if (fs.existsSync(filePath)) {
            try { settings = JSON.parse(fs.readFileSync(filePath, "utf-8")); } catch { /* ignore */ }
        }

        // Remove from all lists first
        settings.allow = (settings.allow || []).filter(id => id !== toolId);
        settings.deny = (settings.deny || []).filter(id => id !== toolId);
        settings.ask = (settings.ask || []).filter(id => id !== toolId);

        // Add to the correct list
        if (action === "allow") (settings.allow ||= []).push(toolId);
        else if (action === "deny") (settings.deny ||= []).push(toolId);
        else if (action === "ask") (settings.ask ||= []).push(toolId);

        fs.writeFileSync(filePath, JSON.stringify(settings, null, 2));

        // Reload local layer
        this.loadConfigLayers();
    }

    /**
     * Evaluate access for a specific tool, optionally with arguments for wildcard matching.
     */
    evaluate(toolId: string, args?: Record<string, any>): { action: PolicyAction; reason?: string } {
        for (const layer of this.layers) {
            for (const rule of layer.rules) {
                if (matchesWildcard(rule.toolId, toolId, args)) {
                    log.debug(`Policy "${layer.name}" -> ${toolId}: ${rule.action}`);
                    return { action: rule.action, reason: rule.reason };
                }
            }
        }
        return { action: "allow" }; // default: allow
    }

    /**
     * Check if a file operation is allowed (combines tool policy + path protection).
     */
    evaluateFileOp(toolId: string, filePath: string): { action: PolicyAction; reason?: string } {
        // Path protection always wins
        const pathBlock = isProtectedPath(filePath);
        if (pathBlock) {
            return { action: "ask", reason: pathBlock };
        }

        return this.evaluate(toolId, { file_path: filePath });
    }

    /** Filter out denied tools from a list */
    filterTools(tools: OrbitTool[]): OrbitTool[] {
        return tools.filter(t => this.evaluate(t.id).action !== "deny");
    }

    /** Get all active layers (for debugging/UI) */
    getLayers(): PolicyLayer[] {
        return [...this.layers];
    }

    /** Reload configuration layers from disk */
    loadConfigLayers(): void {
        // User settings: ~/.orbit/settings.json
        const userSettingsPath = path.join(os.homedir(), ".orbit", "settings.json");
        const userRules = loadSettingsFile(userSettingsPath);
        if (userRules.length > 0) {
            this.addLayer({ name: "user", priority: 80, rules: userRules });
        }

        // Project settings: .orbit/settings.json
        const projectSettingsPath = path.join(process.cwd(), ".orbit", "settings.json");
        const projectRules = loadSettingsFile(projectSettingsPath);
        if (projectRules.length > 0) {
            this.addLayer({ name: "project", priority: 60, rules: projectRules });
        }

        // Local settings: .orbit/settings.local.json
        const localSettingsPath = path.join(process.cwd(), ".orbit", "settings.local.json");
        const localRules = loadSettingsFile(localSettingsPath);
        if (localRules.length > 0) {
            this.addLayer({ name: "local", priority: 40, rules: localRules });
        }
    }
}

// ── Singleton ────────────────────────────────────────────────────────────────

export const policyEngine = new ToolPolicyEngine();

// Layer 1: Hardcoded system policy (highest priority)
policyEngine.addLayer({
    name: "policy",
    priority: 100,
    rules: [
        { toolId: "cmd_control", action: "ask", reason: "Ejecución de comando del sistema" },
    ],
});

// Layer 5: Session (starts empty, rules added at runtime)
policyEngine.addLayer({
    name: "session",
    priority: 20,
    rules: [],
});

// Layer 6: Default (lowest priority — everything allowed)
policyEngine.addLayer({
    name: "default",
    priority: 0,
    rules: [],
});

// Load file-based layers on startup
policyEngine.loadConfigLayers();

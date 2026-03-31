/**
 * Orbit Tool Policy Engine
 * Phase 1.3 — Layered policy system for tool access control.
 * Higher-priority layers override lower ones.
 */

import { createLogger } from "../infra/logger.js";
import type { OrbitTool } from "./registry.js";

const log = createLogger("ToolPolicy");

// ── Types ────────────────────────────────────────────────────────────────────

export type PolicyAction = "allow" | "deny" | "ask";

export interface ToolPolicy {
    toolId: string;       // tool id or "*" for all
    action: PolicyAction;
    reason?: string;
}

export interface PolicyLayer {
    name:     string;
    priority: number;     // higher = more authority
    rules:    ToolPolicy[];
}

// ── Engine ───────────────────────────────────────────────────────────────────

class ToolPolicyEngine {
    private layers: PolicyLayer[] = [];

    addLayer(layer: PolicyLayer): void {
        this.layers.push(layer);
        this.layers.sort((a, b) => b.priority - a.priority);
    }

    removeLayer(name: string): void {
        this.layers = this.layers.filter(l => l.name !== name);
    }

    /** Evaluate access for a specific tool. First matching rule wins. */
    evaluate(toolId: string): { action: PolicyAction; reason?: string } {
        for (const layer of this.layers) {
            // Check specific rule first, then wildcard
            const rule = layer.rules.find(r => r.toolId === toolId)
                      || layer.rules.find(r => r.toolId === "*");
            if (rule) {
                log.debug(`Policy "${layer.name}" -> ${toolId}: ${rule.action}`);
                return { action: rule.action, reason: rule.reason };
            }
        }
        return { action: "allow" }; // default: allow
    }

    /** Filter out denied tools from a list */
    filterTools(tools: OrbitTool[]): OrbitTool[] {
        return tools.filter(t => this.evaluate(t.id).action !== "deny");
    }

    /** Get all active layers (for debugging/UI) */
    getLayers(): PolicyLayer[] {
        return [...this.layers];
    }
}

// ── Singleton ────────────────────────────────────────────────────────────────

export const policyEngine = new ToolPolicyEngine();

// Default base layer — everything allowed. Override with higher-priority layers.
policyEngine.addLayer({
    name: "default",
    priority: 0,
    rules: [],
});

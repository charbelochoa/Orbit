/**
 * Orbit Subagent Registry
 * Phase 4.1 — Spawn, monitor, and terminate subagents with isolated contexts.
 * Inspired by OpenClaw's subagent-registry with lifecycle management.
 */

import { AgentExecutor } from "./executor.js";
import { createLogger } from "../infra/logger.js";
import { broadcast } from "../gateway/server.js";
import type { ToolProfile } from "../core/registry.js";

const log = createLogger("SubagentRegistry");

// ── Types ─────────────────────────────────────────────────────────────────────

export type SubagentStatus = "pending" | "running" | "done" | "failed" | "cancelled";

export interface SubagentConfig {
    id:              string;
    goal:            string;
    parentSessionId: string;
    toolProfile?:    ToolProfile;
    maxSteps?:       number;
    timeoutMs?:      number;
    context?:        string;   // extra context injected into planner
}

export interface SubagentRecord {
    config:    SubagentConfig;
    status:    SubagentStatus;
    result?:   string;
    error?:    string;
    executor:  AgentExecutor;
    startedAt: Date;
    endedAt?:  Date;
    timeoutId?: ReturnType<typeof setTimeout>;
}

// ── Registry ──────────────────────────────────────────────────────────────────

class SubagentRegistryClass {
    private agents = new Map<string, SubagentRecord>();

    /**
     * Spawn a subagent and start executing its goal.
     * Returns the subagent ID immediately (async, non-blocking).
     */
    async spawn(config: Omit<SubagentConfig, "id">): Promise<string> {
        const id = `sub_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
        const fullConfig: SubagentConfig = { ...config, id };

        const executor = new AgentExecutor();
        const record: SubagentRecord = {
            config:    fullConfig,
            status:    "pending",
            executor,
            startedAt: new Date(),
        };

        this.agents.set(id, record);
        log.info(`Subagente '${id}' creado para: ${config.goal.slice(0, 60)}`);

        broadcast({
            type:     "subagent_spawned",
            id,
            goal:     config.goal,
            parentId: config.parentSessionId,
        });

        // Run async — don't await
        this._run(id);

        return id;
    }

    private async _run(id: string): Promise<void> {
        const record = this.agents.get(id);
        if (!record) return;

        record.status = "running";

        // Optional timeout
        if (record.config.timeoutMs) {
            record.timeoutId = setTimeout(() => {
                log.warn(`Subagente '${id}' timeout.`);
                record.executor.cancel();
            }, record.config.timeoutMs);
        }

        try {
            const result = await record.executor.executeGoal(
                record.config.goal,
                undefined, // no speak callback for subagents
            );
            record.status  = "done";
            record.result  = result;
            record.endedAt = new Date();
            log.info(`Subagente '${id}' completado.`);
            broadcast({ type: "subagent_done", id, result });
        } catch (e: any) {
            record.status  = "failed";
            record.error   = e.message;
            record.endedAt = new Date();
            log.error(`Subagente '${id}' fallo:`, e.message);
            broadcast({ type: "subagent_failed", id, error: e.message });
        } finally {
            if (record.timeoutId) clearTimeout(record.timeoutId);
        }
    }

    /**
     * Cancel a running subagent.
     */
    cancel(id: string): void {
        const record = this.agents.get(id);
        if (!record) return;
        if (record.timeoutId) clearTimeout(record.timeoutId);
        record.executor.cancel();
        record.status  = "cancelled";
        record.endedAt = new Date();
        log.info(`Subagente '${id}' cancelado.`);
        broadcast({ type: "subagent_cancelled", id });
    }

    /**
     * Wait until a subagent completes (or fails/cancels).
     * Returns the result string or throws.
     */
    async wait(id: string, timeoutMs = 120_000): Promise<string> {
        const deadline = Date.now() + timeoutMs;
        while (Date.now() < deadline) {
            const record = this.agents.get(id);
            if (!record) throw new Error(`Subagente '${id}' no encontrado.`);
            if (record.status === "done")      return record.result || "";
            if (record.status === "failed")    throw new Error(record.error || "Subagente fallo.");
            if (record.status === "cancelled") throw new Error("Subagente cancelado.");
            await new Promise(r => setTimeout(r, 300));
        }
        this.cancel(id);
        throw new Error(`Subagente '${id}' timeout despues de ${timeoutMs}ms.`);
    }

    get(id: string): SubagentRecord | undefined {
        return this.agents.get(id);
    }

    listByParent(parentSessionId: string): SubagentRecord[] {
        return Array.from(this.agents.values()).filter(
            r => r.config.parentSessionId === parentSessionId
        );
    }

    listAll(): SubagentRecord[] {
        return Array.from(this.agents.values());
    }

    /** Prune completed/failed/cancelled agents older than maxAgeMs */
    prune(maxAgeMs = 30 * 60_000): void {
        const now = Date.now();
        for (const [id, record] of this.agents.entries()) {
            const terminal = ["done", "failed", "cancelled"].includes(record.status);
            const age = record.endedAt ? now - record.endedAt.getTime() : 0;
            if (terminal && age > maxAgeMs) {
                this.agents.delete(id);
            }
        }
    }
}

export const subagentRegistry = new SubagentRegistryClass();

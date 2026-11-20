import { randomUUID } from "node:crypto";
import { AgentExecutor } from "./executor.js";
import { createLogger } from "../infra/logger.js";
import { broadcast } from "../gateway/server.js";
import { raceWithAbortSignal } from "../infra/race-abort.js";
import type { ToolProfile } from "../core/registry.js";

const log = createLogger("SubagentRegistry");
const MAX_ACTIVE = 12;
const MAX_HISTORY = 80;
const DEFAULT_TIMEOUT_MS = 120_000;
const profiles = new Set<ToolProfile>(["minimal", "standard", "coding", "full"]);

type TerminalStatus = "done" | "failed" | "cancelled" | "timeout";

export interface SubagentConfig {
    goal: string;
    parentSessionId: string;
    toolProfile?: ToolProfile;
    maxSteps?: number;
    timeoutMs?: number;
    context?: string;
    swarmId?: string;
}

export interface SubagentRecord {
    id: string;
    config: SubagentConfig;
    status: "pending" | "running" | TerminalStatus;
    result?: string;
    error?: string;
    startedAt: Date;
    endedAt?: Date;
}

interface SubagentRun {
    record: SubagentRecord;
    executor: AgentExecutor;
    completion: Promise<SubagentRecord>;
    resolve: (record: SubagentRecord) => void;
}

class SubagentRegistry {
    private readonly runs = new Map<string, SubagentRun>();
    private readonly active = new Set<SubagentRun>();
    private closing = false;

    spawn(config: SubagentConfig, signal?: AbortSignal): string {
        signal?.throwIfAborted();
        if (this.closing) throw new Error("Orbit se está cerrando.");
        if (this.active.size >= MAX_ACTIVE) throw new Error("Límite de subagentes activos alcanzado.");

        const goal = config.goal.trim();
        if (!goal || goal.length > 32_000) throw new Error("Indica un objetivo de hasta 32 000 caracteres.");
        if (config.toolProfile !== undefined && !profiles.has(config.toolProfile)) throw new Error("Perfil de subagente inválido.");
        const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
        if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 3_600_000) {
            throw new Error("El tiempo límite del subagente debe estar entre 1 y 3 600 000 ms.");
        }

        const id = `sub_${randomUUID()}`;
        const executor = new AgentExecutor(id, {
            context: config.context?.slice(0, 8000),
            toolProfile: config.toolProfile,
            maxSteps: config.maxSteps ?? 8,
        });
        const record: SubagentRecord = { id, config: { ...config, goal }, status: "pending", startedAt: new Date() };
        let resolve!: (settled: SubagentRecord) => void;
        const completion = new Promise<SubagentRecord>(settle => { resolve = settle; });
        const run = { record, executor, completion, resolve };
        this.runs.set(id, run);
        this.active.add(run);
        this.prune();
        broadcast({ type: "subagent_spawned", id, goal, parentId: config.parentSessionId, swarmId: config.swarmId });
        void this.run(run, timeoutMs, signal);
        return id;
    }

    private async run(run: SubagentRun, timeoutMs: number, parent?: AbortSignal): Promise<void> {
        const { record, executor } = run;
        const onAbort = () => {
            const timedOut = parent?.reason?.name === "TimeoutError";
            this.stop(run, timedOut ? "timeout" : "cancelled", "El turno de origen terminó la ejecución.");
        };
        const timer = setTimeout(() => this.stop(run, "timeout", "Se agotó el plazo del subagente."), timeoutMs);
        parent?.addEventListener("abort", onAbort, { once: true });
        try {
            if (parent?.aborted) onAbort();
            if (record.endedAt) return;
            record.status = "running";
            const result = await executor.executeGoal(record.config.goal);
            this.finish(run, "done", result);
        } catch (error) {
            this.finish(run, "failed", error instanceof Error ? error.message : String(error));
        } finally {
            parent?.removeEventListener("abort", onAbort);
            clearTimeout(timer);
            this.active.delete(run);
        }
    }

    private finish(run: SubagentRun, status: TerminalStatus, details: string): void {
        const { record } = run;
        if (record.endedAt) return;
        record.status = status;
        record.endedAt = new Date();
        if (status === "done") record.result = details;
        else record.error = details;
        run.resolve(record);
        log.info(`Subagente '${record.id}': ${status}`);
        broadcast({
            type: `subagent_${status}`, id: record.id, swarmId: record.config.swarmId,
            result: record.result?.slice(0, 1000), error: record.error?.slice(0, 1000),
        });
    }

    private stop(run: SubagentRun, status: "cancelled" | "timeout", message: string): boolean {
        if (run.record.endedAt) return false;
        run.executor.cancel(new Error(message));
        this.finish(run, status, message);
        return true;
    }

    cancel(id: string): boolean {
        const run = this.runs.get(id);
        return !!run && this.stop(run, "cancelled", "Subagente cancelado por el usuario.");
    }

    stopAll(): void {
        this.closing = true;
        for (const run of this.active) this.stop(run, "cancelled", "Orbit se está cerrando.");
    }

    async wait(id: string, signal?: AbortSignal): Promise<SubagentRecord> {
        const run = this.runs.get(id);
        if (!run) throw new Error(`Subagente '${id}' no encontrado.`);
        if (run.record.endedAt) return run.record;
        return signal ? raceWithAbortSignal(run.completion, signal) : run.completion;
    }

    get(id: string): SubagentRecord | undefined {
        return this.runs.get(id)?.record;
    }

    listAll(): SubagentRecord[] {
        return Array.from(this.runs.values(), run => run.record);
    }

    private prune(): void {
        if (this.runs.size <= MAX_HISTORY) return;
        for (const [id, run] of this.runs) {
            if (run.record.endedAt && !this.active.has(run)) this.runs.delete(id);
            if (this.runs.size <= MAX_HISTORY) return;
        }
    }
}

export const subagentRegistry = new SubagentRegistry();

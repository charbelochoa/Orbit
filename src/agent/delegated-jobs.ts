import { cancelSwarm, getSwarmSummary, listSwarms } from "./swarm.js";
import { subagentRegistry } from "./subagent-registry.js";
import { getQueue } from "./task-queue.js";
import { cancelBackgroundProcess } from "../actions/cmd-control.js";

export function cancelWork(id: string): boolean {
    if (id.startsWith("bg-")) return cancelBackgroundProcess(id);
    if (id.startsWith("swarm_")) return cancelSwarm(id);
    if (id.startsWith("sub_")) return subagentRegistry.cancel(id);
    return getQueue().cancel(id);
}

export function listDelegatedJobs() {
    const groups = listSwarms().map(({ id, name, createdAt, status, steps, summary }) => ({
        id, kind: "swarm", goal: name, status, createdAt, steps, result: summary?.slice(0, 1000),
    }));
    const agents = subagentRegistry.listAll().map(({ id, config, status, startedAt, result, error }) => ({
        id, kind: "subagent", goal: config.goal.slice(0, 160), status, createdAt: startedAt.toISOString(),
        result: result?.slice(0, 1000), error: error?.slice(0, 1000),
    }));
    return [...groups, ...agents].sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

export function getDelegatedOutput(id: string): string | undefined {
    if (id.startsWith("swarm_")) return getSwarmSummary(id);
    const agent = subagentRegistry.get(id);
    return agent?.result || agent?.error;
}

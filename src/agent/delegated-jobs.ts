import { cancelSwarm, listSwarms } from "./swarm.js";
import { subagentRegistry } from "./subagent-registry.js";
import { getQueue } from "./task-queue.js";

export function cancelWork(id: string): boolean {
    if (id.startsWith("swarm_")) return cancelSwarm(id);
    if (id.startsWith("sub_")) return subagentRegistry.cancel(id);
    return getQueue().cancel(id);
}

export function listDelegatedJobs() {
    const groups = listSwarms().map(({ id, name, createdAt, status, steps, summary }) => ({
        id, kind: "swarm", goal: name, status, createdAt, steps, result: summary,
    }));
    const agents = subagentRegistry.listAll().map(({ id, config, status, startedAt, result, error }) => ({
        id, kind: "subagent", goal: config.goal.slice(0, 160), status, createdAt: startedAt.toISOString(),
        result: result?.slice(0, 1000), error: error?.slice(0, 1000),
    }));
    return [...groups, ...agents].sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

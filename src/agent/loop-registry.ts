/**
 * loop-registry.ts
 * Singleton registry for all active VisualAgentLoop instances.
 * Allows the gateway to pause/resume/stop loops by ID.
 */

import type { VisualAgentLoop } from "./visual-loop.js";

class LoopRegistry {
    private _loops = new Map<string, VisualAgentLoop>();

    /** Register a loop before starting it. */
    register(id: string, loop: VisualAgentLoop): void {
        this._loops.set(id, loop);
    }

    /** Remove a loop once it's done. */
    unregister(id: string): void {
        this._loops.delete(id);
    }

    /** Get a loop by ID. */
    get(id: string): VisualAgentLoop | undefined {
        return this._loops.get(id);
    }

    /**
     * Returns the first running loop, or the first paused loop if none running.
     * Useful when the caller doesn't know the specific ID.
     */
    getActive(): VisualAgentLoop | undefined {
        for (const loop of this._loops.values()) {
            if (loop.status === "running") return loop;
        }
        for (const loop of this._loops.values()) {
            if (loop.status === "paused") return loop;
        }
        return undefined;
    }

    /** All registered loop IDs and their statuses. */
    listAll(): Array<{ id: string; status: string }> {
        return Array.from(this._loops.entries()).map(([id, loop]) => ({
            id,
            status: loop.status,
        }));
    }

    /** Number of active (running + paused) loops. */
    get count(): number { return this._loops.size; }
}

export const loopRegistry = new LoopRegistry();

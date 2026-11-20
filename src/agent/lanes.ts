import { toolRegistry } from "../core/registry.js";

type Release = () => void;

interface QueueEntry {
    queued: boolean;
    previous?: QueueEntry;
    next?: QueueEntry;
    releaseQueuedAbort?: () => void;
    resolve: (release: Release) => void;
}

interface QueueFifo {
    head?: QueueEntry;
    tail?: QueueEntry;
    length: number;
}

function appendEntry(fifo: QueueFifo, entry: QueueEntry): void {
    entry.queued = true;
    entry.previous = fifo.tail;
    entry.next = undefined;
    if (fifo.tail) {
        fifo.tail.next = entry;
    } else {
        fifo.head = entry;
    }
    fifo.tail = entry;
    fifo.length += 1;
}

function removeLaneQueueEntry(fifo: QueueFifo, entry: QueueEntry): boolean {
    if (!entry.queued) return false;
    if (entry.previous) {
        entry.previous.next = entry.next;
    } else {
        fifo.head = entry.next;
    }
    if (entry.next) {
        entry.next.previous = entry.previous;
    } else {
        fifo.tail = entry.previous;
    }
    entry.queued = false;
    fifo.length -= 1;
    const releaseQueuedAbort = entry.releaseQueuedAbort;
    entry.previous = undefined;
    entry.next = undefined;
    entry.releaseQueuedAbort = undefined;
    releaseQueuedAbort?.();
    return true;
}

class Semaphore {
    private readonly queue: QueueFifo = { length: 0 };
    private active = 0;

    constructor(private readonly capacity: number) {}

    acquire(signal?: AbortSignal): Promise<Release> {
        signal?.throwIfAborted();
        if (this.active < this.capacity) {
            this.active++;
            return Promise.resolve(this.release);
        }
        return new Promise((resolve, reject) => {
            const entry: QueueEntry = { queued: false, resolve };
            if (signal) {
                const abort = () => {
                    if (removeLaneQueueEntry(this.queue, entry)) reject(signal.reason);
                };
                signal.addEventListener("abort", abort, { once: true });
                entry.releaseQueuedAbort = () => signal.removeEventListener("abort", abort);
            }
            appendEntry(this.queue, entry);
        });
    }

    private release = (): void => {
        const next = this.queue.head;
        if (!next) {
            this.active--;
            return;
        }
        removeLaneQueueEntry(this.queue, next);
        next.resolve(this.release);
    };

    get idle(): boolean { return this.active === 0 && this.queue.length === 0; }
    get available(): number { return this.capacity - this.active; }
    get waiting(): number { return this.queue.length; }
}

const globalLane = new Semaphore(6);
const desktopLane = new Semaphore(1);
const sessionLanes = new Map<string, Semaphore>();

export async function runInLane<T>(
    sessionId: string,
    work: () => Promise<T>,
    signal?: AbortSignal,
    toolName?: string,
): Promise<T> {
    if (toolName === "run_swarm") {
        signal?.throwIfAborted();
        return work();
    }
    const sessionLane = sessionLanes.get(sessionId) ?? new Semaphore(3);
    sessionLanes.set(sessionId, sessionLane);
    let releaseSession: Release | undefined;
    let releaseDesktop: Release | undefined;
    let releaseGlobal: Release | undefined;
    try {
        releaseSession = await sessionLane.acquire(signal);
        if (toolName && (toolName === "browser_control" || toolRegistry.get(toolName)?.capabilities.requiresUI)) {
            releaseDesktop = await desktopLane.acquire(signal);
        }
        releaseGlobal = await globalLane.acquire(signal);
        signal?.throwIfAborted();
        return await work();
    } finally {
        releaseGlobal?.();
        releaseDesktop?.();
        releaseSession?.();
        destroySessionLane(sessionId);
    }
}

export function destroySessionLane(sessionId: string): void {
    if (sessionLanes.get(sessionId)?.idle) sessionLanes.delete(sessionId);
}

export function getLaneStats() {
    return { globalAvailable: globalLane.available, globalWaiting: globalLane.waiting, sessions: sessionLanes.size };
}

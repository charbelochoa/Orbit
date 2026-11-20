export class KeyedAsyncQueue {
    private readonly tails = new Map<string, Promise<void>>();

    async enqueue<T>(requestedKeys: string | readonly string[], task: () => Promise<T>, signal?: AbortSignal): Promise<T> {
        signal?.throwIfAborted();
        const keys = typeof requestedKeys === "string" ? [requestedKeys] : [...new Set(requestedKeys)];
        const previous = Promise.allSettled(keys.map(key => this.tails.get(key) ?? Promise.resolve()));
        const current = previous.then(() => {
            signal?.throwIfAborted();
            return task();
        });
        const tail = current.then(() => undefined, () => undefined);
        for (const key of keys) this.tails.set(key, tail);
        void tail.then(() => {
            for (const key of keys) {
                if (this.tails.get(key) === tail) this.tails.delete(key);
            }
        });
        if (signal) await waitForAdmission(previous, signal);
        return current;
    }
}

async function waitForAdmission(previous: Promise<unknown>, signal: AbortSignal): Promise<void> {
    signal.throwIfAborted();
    await new Promise<void>((resolve, reject) => {
        const abort = () => reject(signal.reason);
        signal.addEventListener("abort", abort, { once: true });
        void previous.then(() => {
            signal.removeEventListener("abort", abort);
            resolve();
        });
    });
}

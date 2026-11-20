export function raceWithAbortSignal<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
    return new Promise<T>((resolve, reject) => {
        const onAbort = () => {
            signal.removeEventListener("abort", onAbort);
            reject(signal.reason);
        };
        signal.addEventListener("abort", onAbort, { once: true });
        promise.then(
            value => {
                signal.removeEventListener("abort", onAbort);
                resolve(value);
            },
            error => {
                signal.removeEventListener("abort", onAbort);
                reject(error);
            },
        );
        if (signal.aborted) onAbort();
    });
}

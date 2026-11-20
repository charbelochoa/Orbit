import { execFile, type ChildProcess } from "node:child_process";
import path from "node:path";
import { raceWithAbortSignal } from "./race-abort.js";

export class ProcessTimeoutError extends Error {
    constructor() {
        super("Se agotó el tiempo del proceso.");
        this.name = "ProcessTimeoutError";
    }
}

export async function stopProcess(child: ChildProcess): Promise<void> {
    if (child.pid && child.exitCode === null && child.signalCode === null) {
        if (process.platform === "win32") {
            await new Promise<void>(resolve => {
                const systemDirectory = path.join(process.env.SystemRoot || "C:\\Windows", "System32");
                execFile(path.join(systemDirectory, "taskkill.exe"), ["/pid", String(child.pid), "/t", "/f"], {
                    windowsHide: true,
                    timeout: 2000,
                }, () => resolve());
            });
        }
        if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    }
    child.stdin?.destroy();
    child.stdout?.destroy();
    child.stderr?.destroy();
    child.unref();
}

export async function waitForProcess<T>(child: ChildProcess, completion: Promise<T>, timeoutMs: number, signal?: AbortSignal): Promise<T> {
    const timeout = new AbortController();
    const timer = setTimeout(() => timeout.abort(new ProcessTimeoutError()), timeoutMs);
    const lifetime = signal ? AbortSignal.any([signal, timeout.signal]) : timeout.signal;
    try {
        const result = await raceWithAbortSignal(completion, lifetime);
        lifetime.throwIfAborted();
        return result;
    } catch (error) {
        if (!lifetime.aborted) throw error;
        await stopProcess(child);
        throw lifetime.reason;
    } finally {
        clearTimeout(timer);
    }
}

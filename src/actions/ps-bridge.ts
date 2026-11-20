import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import path from "node:path";
import { createInterface } from "node:readline";
import { KeyedAsyncQueue } from "../infra/keyed-async-queue.js";
import { raceWithAbortSignal } from "../infra/race-abort.js";
import { desktopWorker } from "./desktop-worker.js";

export type DesktopPoint = [number, number];
export type MouseButton = "left" | "right" | "double";

type DesktopCommand =
    | { op: "position" | "screen" }
    | { op: "move" | "drag"; points: number[]; delay: number }
    | { op: "click"; button: MouseButton }
    | { op: "keys"; modifiers: number[]; key: number; extended: boolean }
    | { op: "scroll"; amount: number; horizontal: boolean }
    | { op: "type"; text: string }
    | { op: "focus"; title: string };

interface Pending {
    id: number;
    resolve: (value: unknown) => void;
    reject: (error: Error) => void;
    timer: ReturnType<typeof setTimeout>;
}

const queue = new KeyedAsyncQueue();
const bootstrap = Buffer.from(desktopWorker, "utf16le").toString("base64");
let session: DesktopSession | undefined;
let closing = false;

class DesktopSession {
    private readonly child: ChildProcessWithoutNullStreams;
    private nextId = 0;
    private pending?: Pending;
    failure?: Error;
    readonly ready: Promise<void>;
    readonly closed: Promise<void>;

    constructor() {
        const systemRoot = process.env.SystemRoot || "C:\\Windows";
        const executable = path.join(systemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
        this.child = spawn(executable, ["-NoProfile", "-NoLogo", "-NonInteractive", "-STA", "-EncodedCommand", bootstrap], {
            stdio: ["pipe", "pipe", "pipe"],
            windowsHide: true,
        });
        this.closed = new Promise(resolve => {
            this.child.once("close", () => {
                this.fail(new Error("El puente de escritorio se cerró."));
                if (session === this) session = undefined;
                resolve();
            });
        });
        this.ready = new Promise((resolve, reject) => {
            this.pending = {
                id: 0, resolve: () => resolve(), reject,
                timer: setTimeout(() => this.stop(new Error("El puente de escritorio tardó demasiado en iniciar.")), 15_000),
            };
        });
        this.child.on("error", error => this.stop(error));
        this.child.stdin.on("error", error => this.stop(error));
        this.child.stderr.resume();
        const replies = createInterface({ input: this.child.stdout, crlfDelay: Infinity });
        replies.on("line", line => this.receive(line));
        replies.on("error", error => this.stop(error));
    }

    private takePending(): Pending | undefined {
        const pending = this.pending;
        if (pending) clearTimeout(pending.timer);
        this.pending = undefined;
        return pending;
    }

    private receive(line: string): void {
        if (!this.pending || this.failure) return;
        let reply: { id?: number; ready?: boolean; error?: string; value?: unknown };
        try {
            reply = JSON.parse(line.trim());
        } catch {
            this.stop(new Error("El puente de escritorio devolvió una respuesta inválida."));
            return;
        }
        const id = reply?.ready === true ? 0 : reply?.id;
        if (this.pending.id !== id) {
            this.stop(new Error("La respuesta del puente no corresponde a la operación activa."));
            return;
        }
        const pending = this.takePending()!;
        if (reply.error) pending.reject(new Error(reply.error));
        else pending.resolve(reply.value);
    }

    private fail(error: Error): boolean {
        if (this.failure) return false;
        this.failure = error;
        this.takePending()?.reject(error);
        return true;
    }

    stop(error: Error): void {
        if (this.fail(error)) this.child.kill();
    }

    async send(command: DesktopCommand): Promise<unknown> {
        if (this.failure) throw this.failure;
        if (this.pending) throw new Error("El puente de escritorio sigue ocupado.");
        const id = ++this.nextId;
        const payload = Buffer.from(JSON.stringify({ id, ...command }), "utf8").toString("base64");
        return new Promise((resolve, reject) => {
            this.pending = {
                id, resolve, reject,
                timer: setTimeout(() => this.stop(new Error("La operación de escritorio agotó su plazo.")), 5000),
            };
            try {
                this.child.stdin.write(payload + "\n", error => { if (error) this.stop(error); });
            } catch (error) {
                this.stop(error instanceof Error ? error : new Error(String(error)));
            }
        });
    }
}

function inDesktop<T>(signal: AbortSignal | undefined, operation: (send: (command: DesktopCommand) => Promise<unknown>) => Promise<T>): Promise<T> {
    return queue.enqueue("desktop", async () => {
        if (process.platform !== "win32") throw new Error("El control de escritorio requiere Windows.");
        if (closing) throw new Error("Orbit se está cerrando.");
        if (session?.failure) {
            if (signal) await raceWithAbortSignal(session.closed, signal);
            else await session.closed;
        }
        signal?.throwIfAborted();
        if (closing) throw new Error("Orbit se está cerrando.");
        const worker = session ??= new DesktopSession();
        if (signal) await raceWithAbortSignal(worker.ready, signal);
        else await worker.ready;
        return operation(async command => {
            signal?.throwIfAborted();
            if (closing) throw new Error("Orbit se está cerrando.");
            const result = await worker.send(command);
            signal?.throwIfAborted();
            return result;
        });
    }, signal);
}

export function killPS(): void {
    closing = true;
    session?.stop(new Error("Orbit se está cerrando."));
}

export function desktopPoint(x: unknown, y: unknown): DesktopPoint {
    if (typeof x !== "number" || typeof y !== "number" || !Number.isFinite(x) || !Number.isFinite(y) ||
        Math.abs(x) > 100_000 || Math.abs(y) > 100_000) {
        throw new Error("Indica coordenadas de escritorio válidas.");
    }
    return [Math.round(x), Math.round(y)];
}

function readPoint(value: unknown): DesktopPoint {
    if (!Array.isArray(value) || value.length !== 2) throw new Error("El puente no devolvió coordenadas válidas.");
    return desktopPoint(value[0], value[1]);
}

function pointerPath(from: DesktopPoint, to: DesktopPoint): { points: number[]; delay: number } {
    const dx = to[0] - from[0];
    const dy = to[1] - from[1];
    const distance = Math.hypot(dx, dy);
    if (distance < 2) return { points: [...to], delay: 0 };
    const steps = Math.max(4, Math.min(24, Math.round(distance / 22)));
    const middleX = from[0] + dx / 2 - dy * 0.12;
    const middleY = from[1] + dy / 2 + dx * 0.12;
    const points: number[] = [];
    for (let i = 1; i <= steps; i++) {
        const fraction = i / steps;
        const t = fraction * fraction * (3 - 2 * fraction);
        const u = 1 - t;
        points.push(
            Math.round(u * u * from[0] + 2 * u * t * middleX + t * t * to[0]),
            Math.round(u * u * from[1] + 2 * u * t * middleY + t * t * to[1]),
        );
    }
    return { points, delay: Math.min(10, Math.round(140 / steps)) };
}

export function getScreenSize(signal?: AbortSignal): Promise<DesktopPoint> {
    return inDesktop(signal, async send => readPoint(await send({ op: "screen" })));
}

export function movePointer(to: DesktopPoint, button?: MouseButton, signal?: AbortSignal): Promise<void> {
    return inDesktop(signal, async send => {
        const from = readPoint(await send({ op: "position" }));
        await send({ op: "move", ...pointerPath(from, to) });
        if (button) await send({ op: "click", button });
    });
}

export function dragPointer(to: DesktopPoint, from?: DesktopPoint, signal?: AbortSignal): Promise<DesktopPoint> {
    return inDesktop(signal, async send => {
        const cursor = readPoint(await send({ op: "position" }));
        if (from) await send({ op: "move", ...pointerPath(cursor, from) });
        const start = from ?? cursor;
        await send({ op: "drag", ...pointerPath(start, to) });
        return start;
    });
}

export async function scrollPointer(amount: number, horizontal: boolean, signal?: AbortSignal): Promise<void> {
    await inDesktop(signal, send => send({ op: "scroll", amount, horizontal }));
}

export async function pressDesktopKeys(modifiers: number[], key: number, extended: boolean, signal?: AbortSignal): Promise<void> {
    await inDesktop(signal, send => send({ op: "keys", modifiers, key, extended }));
}

export async function pasteDesktopText(text: string, signal?: AbortSignal): Promise<void> {
    await inDesktop(signal, send => send({ op: "type", text }));
}

export async function focusDesktopWindow(title: string, signal?: AbortSignal): Promise<void> {
    await inDesktop(signal, send => send({ op: "focus", title }));
}

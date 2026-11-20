export const MAX_VOICE_BYTES = 960_000;
const MAX_PACKET_BYTES = 16_000;
const MAX_PACKETS = 320;

export function pcmByteLength(value: unknown, limit: number): number {
    if (typeof value !== "string" || !value.length || value.length > Math.ceil(limit / 3) * 4 ||
        value.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) return 0;
    const bytes = Buffer.byteLength(value, "base64");
    return bytes > 0 && bytes <= limit && bytes % 2 === 0 ? bytes : 0;
}

export class VoiceInput implements AsyncIterable<string> {
    private readonly queue: string[] = [];
    private wake?: () => void;
    private ended = false;
    private bytes = 0;
    private packets = 0;

    append(pcm: string): void {
        if (this.ended) return;
        const bytes = pcmByteLength(pcm, MAX_PACKET_BYTES);
        if (!bytes) throw new Error("Orbit recibió un fragmento de audio inválido.");
        if (this.bytes + bytes > MAX_VOICE_BYTES || this.packets >= MAX_PACKETS) {
            throw new Error("La grabación supera el límite de audio del turno.");
        }
        this.bytes += bytes;
        this.packets++;
        this.queue.push(pcm);
        this.wake?.();
    }

    finish(): void {
        this.ended = true;
        this.wake?.();
    }

    discard(): void {
        this.queue.length = 0;
        this.finish();
    }

    async *[Symbol.asyncIterator](): AsyncGenerator<string> {
        while (!this.ended || this.queue.length) {
            const next = this.queue.shift();
            if (next !== undefined) yield next;
            else {
                await new Promise<void>(resolve => { this.wake = resolve; });
                this.wake = undefined;
            }
        }
    }
}

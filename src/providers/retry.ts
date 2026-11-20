export function parseRetryAfter(value: string | null, now = Date.now()): number | undefined {
    const text = value?.trim();
    if (!text) return undefined;
    const seconds = Number(text);
    if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
    const date = Date.parse(text);
    return Number.isFinite(date) ? Math.max(0, date - now) : undefined;
}

export function jitteredBackoff(attempt: number, baseDelay: number, maxDelay: number, jitter = 0.5): number {
    const exponent = Math.max(0, attempt - 1);
    const delay = Math.min(baseDelay * 2 ** exponent, maxDelay);
    return delay + Math.random() * delay * jitter;
}

export class ProviderHttpError extends Error {
    readonly status: number;
    readonly retryAfter?: number;

    constructor(provider: string, response: Response) {
        super(`${provider} API error ${response.status}`);
        this.status = response.status;
        this.retryAfter = parseRetryAfter(response.headers.get("retry-after"));
    }
}

/**
 * Orbit Permission Broker — Sprint 8
 *
 * When the tool policy engine evaluates a tool invocation as "ask", the executor
 * calls `requestPermission()` which:
 *   1. Broadcasts a `permission_request` WS event to all connected clients.
 *   2. Suspends execution (Promise) until a client sends `permission_response`.
 *   3. Resolves with "allow" | "deny" | "always".
 *
 * If no client responds within `TIMEOUT_MS`, defaults to "deny" (safe default).
 *
 * "always" response → persists allow rule to .orbit/settings.local.json via policyEngine.
 */

import { createLogger }  from "../infra/logger.js";
import { broadcast }     from "../gateway/server.js";
import { policyEngine }  from "./tool-policy.js";
import { workspaceRoot, withWorkspace } from "./workspace.js";

const log = createLogger("permission-broker");

// ── Types ────────────────────────────────────────────────────────────────────

export type PermissionAnswer = "allow" | "deny" | "always";

export interface PermissionRequest {
    requestId:   string;
    toolId:      string;
    description: string;
    args:        Record<string, any>;
    createdAt:   number;
}

// ── Pending requests ─────────────────────────────────────────────────────────

interface Pending {
    req:     PermissionRequest;
    resolve: (answer: PermissionAnswer) => void;
    timer:   ReturnType<typeof setTimeout>;
    cleanup: () => void;
    workspace: string;
}

const _pending = new Map<string, Pending>();

/** Default timeout before auto-denying (ms) */
const TIMEOUT_MS = 60_000;

// ── ID generator ─────────────────────────────────────────────────────────────

let _seq = 0;
function genRequestId(): string {
    return `perm_${Date.now().toString(36)}_${(++_seq).toString(36)}`;
}

// ── Request ───────────────────────────────────────────────────────────────────

/**
 * Ask the user (via WS broadcast) whether to allow a tool invocation.
 * Blocks until user responds or timeout.
 */
export function requestPermission(
    toolId:      string,
    args:        Record<string, any> = {},
    description: string = "",
    signal?: AbortSignal,
): Promise<PermissionAnswer> {
    if (signal?.aborted) return Promise.resolve("deny");
    const requestId = genRequestId();

    const req: PermissionRequest = {
        requestId,
        toolId,
        description: description || `La herramienta '${toolId}' solicita permiso para ejecutarse.`,
        args,
        createdAt: Date.now(),
    };

    log.info(`Permiso requerido: '${toolId}' [${requestId}]`);

    return new Promise<PermissionAnswer>((resolve) => {
        const timer = setTimeout(() => {
            resolvePermission(requestId, "deny");
        }, TIMEOUT_MS);
        const abort = () => resolvePermission(requestId, "deny");
        signal?.addEventListener("abort", abort, { once: true });
        const cleanup = () => signal?.removeEventListener("abort", abort);
        _pending.set(requestId, { req, resolve, timer, cleanup, workspace: workspaceRoot() });

        // Broadcast to all connected clients
        broadcast({
            type:    "permission_request",
            ...req,
        });
    });
}

// ── Resolve ───────────────────────────────────────────────────────────────────

/**
 * Called by the gateway when a client sends a `permission_response` message.
 */
export function resolvePermission(requestId: string, answer: PermissionAnswer): boolean {
    const pending = _pending.get(requestId);
    if (!pending) {
        log.warn(`resolvePermission: requestId '${requestId}' no encontrado (ya expiró o respondido)`);
        return false;
    }

    clearTimeout(pending.timer);
    _pending.delete(requestId);
    pending.cleanup();

    const { toolId } = pending.req;
    log.info(`Permiso para '${toolId}': ${answer}`);

    // Persist "always allow" to local settings
    if (answer === "always") {
        try {
            withWorkspace(pending.workspace, () => policyEngine.saveLocalRule(toolId, "allow"));
            log.info(`Regla persistida: allow ${toolId}`);
        } catch (err: any) {
            log.warn(`No se pudo persistir la regla: ${err.message}`);
        }
    }

    pending.resolve(answer);
    broadcast({ type: "permission_closed", requestId });
    return true;
}

// ── Status ────────────────────────────────────────────────────────────────────

/** List all currently pending permission requests */
export function getPendingRequests(): PermissionRequest[] {
    return Array.from(_pending.values()).map(p => p.req);
}

/** Cancel all pending requests (e.g. on shutdown) */
export function cancelAllPending(): void {
    for (const id of _pending.keys()) resolvePermission(id, "deny");
}

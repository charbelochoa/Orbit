/**
 * Orbit Notifications — Notification Service (Sprint 12)
 * ──────────────────────────────────────────────────────
 * Suscriptor central de eventos del sistema que dispara toasts al usuario.
 *
 * Escucha los siguientes broadcasts internos:
 *   • ambient_rule_triggered  → toast con el mensaje de la regla
 *   • task_update (done)      → toast de tarea completada
 *   • orbit_ready             → toast de inicio de sesión
 *
 * Se puede silenciar por categoría de evento en orbit.yaml (notifications.events).
 */

import { createLogger }    from "../infra/logger.js";
import { getConfig }       from "../config/config.js";
import { onBroadcast }     from "../gateway/server.js";
import { sendToast, setElectronConnected } from "./toast.js";

const log = createLogger("notify");

// Re-export para que index.ts pueda notificar cuando Electron se conecte
export { setElectronConnected };

class NotificationService {
    private _running  = false;
    private _unsub: (() => void) | null = null;
    /** Qué sourceIds (o tipos de evento) están silenciados */
    private _silenced: Set<string> = new Set();

    start(): void {
        if (this._running) return;
        this._running = true;

        const cfg = getConfig();
        const notifCfg = cfg.notifications;
        this._silenced = new Set(notifCfg?.silenced ?? []);

        this._unsub = onBroadcast((msg) => this._handle(msg));
        log.info(`Notification service iniciado (silenciados: ${[...this._silenced].join(", ") || "ninguno"})`);
    }

    stop(): void {
        if (!this._running) return;
        this._running = false;
        this._unsub?.();
        this._unsub = null;
        log.info("Notification service detenido");
    }

    isRunning(): boolean { return this._running; }

    /** Manda un toast de prueba. */
    test(): void {
        sendToast({
            title:    "Orbit — Prueba de notificación",
            body:     "Las notificaciones están funcionando correctamente.",
            category: "success",
            sourceId: "test",
        });
    }

    private _handle(msg: any): void {
        if (!this._running) return;

        switch (msg.type) {
            // ── Regla proactiva disparada ──────────────────────────────────
            case "ambient_rule_triggered": {
                if (this._silenced.has(msg.ruleId) || this._silenced.has("rules")) break;
                sendToast({
                    title:    "Orbit",
                    body:     msg.message ?? "Notificación de contexto",
                    category: "info",
                    sourceId: msg.ruleId ?? "rule",
                });
                break;
            }

            // ── Tarea del agente completada ────────────────────────────────
            case "task_update": {
                if (msg.status !== "done") break;
                if (this._silenced.has("tasks")) break;
                const goal  = (msg.goal ?? "").slice(0, 60);
                const label = goal ? `"${goal}"` : "tarea";
                sendToast({
                    title:    "✓ Tarea completada",
                    body:     `Orbit terminó: ${label}`,
                    category: "success",
                    sourceId: "task_done",
                });
                break;
            }

            // ── Órbita lista (inicio de sesión) ────────────────────────────
            case "orbit_ready": {
                if (this._silenced.has("startup")) break;
                const cfg = getConfig();
                if (cfg.notifications?.notifyOnStartup === false) break;
                sendToast({
                    title:    "Orbit está en línea",
                    body:     "Tu asistente personal está listo.",
                    category: "info",
                    sourceId: "startup",
                    silent:   true, // sin sonido en arranque
                });
                break;
            }

            // ── Errores TypeScript nuevos/resueltos (Sprint 13) ────────────
            case "codebase_errors_changed": {
                if (this._silenced.has("codebase_errors")) break;
                if (msg.added > 0) {
                    sendToast({
                        title:    `🔴 ${msg.added} error${msg.added > 1 ? "es" : ""} TypeScript nuevo${msg.added > 1 ? "s" : ""}`,
                        body:     `Total: ${msg.total} error${msg.total !== 1 ? "es" : ""} en el proyecto`,
                        category: "error",
                        sourceId: "codebase_errors",
                    });
                } else if (msg.resolved > 0 && msg.total === 0) {
                    sendToast({
                        title:    "✅ Todos los errores TS resueltos",
                        body:     "El proyecto compila sin errores.",
                        category: "success",
                        sourceId: "codebase_errors",
                    });
                }
                break;
            }
        }
    }
}

/** Singleton */
export const notificationService = new NotificationService();

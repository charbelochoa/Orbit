/**
 * Orbit Command: /notify — Sprint 12
 * ─────────────────────────────────────
 * Controla el sistema de notificaciones toast y el wake word monitor.
 *
 * Subcomandos:
 *   /notify             — estado actual del servicio
 *   /notify test        — dispara una notificación de prueba
 *   /notify on          — activa el servicio de notificaciones
 *   /notify off         — silencia todas las notificaciones
 *   /notify status      — igual que /notify
 *   /notify wakeword    — estado del monitor de wake word
 */

import { notificationService } from "../../notifications/service.js";
import { wakeWordMonitor }      from "../../notifications/wake-word.js";
import type { CommandContext }  from "../types.js";

export async function notifyCommand(ctx: CommandContext): Promise<string> {
    const sub = (ctx.subcommand || "status").toLowerCase();

    switch (sub) {
        case "test": {
            notificationService.test();
            return "✓ Notificación de prueba enviada. Deberías ver un toast del sistema.";
        }

        case "on":
        case "start": {
            if (notificationService.isRunning()) return "El servicio de notificaciones ya está activo.";
            notificationService.start();
            return "✓ Servicio de notificaciones activado.";
        }

        case "off":
        case "stop": {
            if (!notificationService.isRunning()) return "El servicio de notificaciones ya estaba detenido.";
            notificationService.stop();
            return "Servicio de notificaciones detenido.";
        }

        case "wakeword":
        case "wake":
        case "ww": {
            return [
                `## Wake Word Monitor`,
                ``,
                `**Estado**: ${wakeWordMonitor.isEnabled() ? "✅ activo" : "❌ inactivo"}`,
                `**Activaciones totales**: ${wakeWordMonitor.getTotalFires()}`,
                ``,
                wakeWordMonitor.isEnabled()
                    ? "Pronuncia la palabra clave configurada para activar el overlay."
                    : "Habilita con `wakeWord.enabled: true` en `config/orbit.yaml`.",
            ].join("\n");
        }

        case "status":
        default: {
            return [
                `## Notification Service`,
                ``,
                `**Estado**: ${notificationService.isRunning() ? "✅ activo" : "❌ inactivo"}`,
                `**Wake Word**: ${wakeWordMonitor.isEnabled() ? "✅ activo" : "❌ inactivo"}`,
                ``,
                `**Comandos**:`,
                `  \`/notify test\`     — prueba visual`,
                `  \`/notify on|off\`   — activar/silenciar`,
                `  \`/notify wakeword\` — estado del wake word`,
            ].join("\n");
        }
    }
}

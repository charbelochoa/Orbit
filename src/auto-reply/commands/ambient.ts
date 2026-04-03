/**
 * Orbit Command: /ambient — Sprint 9
 * ─────────────────────────────────────
 * Controla e inspecciona el Ambient Awareness Engine.
 *
 * Subcomandos:
 *   /ambient status      — snapshot actual del motor
 *   /ambient on          — activa el servicio en tiempo real
 *   /ambient off         — detiene el servicio
 *   /ambient window      — ventana activa + historial
 *   /ambient clipboard   — contenido actual del portapapeles
 *   /ambient downloads   — descargas recientes detectadas
 */

import { ambientService } from "../../ambient/service.js";
import type { CommandContext } from "../types.js";

export async function ambientCommand(ctx: CommandContext): Promise<string> {
    const sub = (ctx.subcommand || "status").toLowerCase();

    switch (sub) {
        // ── on: activar ───────────────────────────────────────────
        case "on":
        case "start": {
            if (ambientService.isRunning()) return "El Ambient Engine ya está activo.";
            await ambientService.start();
            return ambientService.isRunning()
                ? "✓ Ambient Awareness Engine activado."
                : "⚠ No se pudo activar — asegúrate de tener `ambient.enabled: true` en config/orbit.yaml y reinicia.";
        }

        // ── off: detener ──────────────────────────────────────────
        case "off":
        case "stop": {
            if (!ambientService.isRunning()) return "El Ambient Engine ya estaba detenido.";
            await ambientService.stop();
            return "Ambient Awareness Engine detenido.";
        }

        // ── window: ventana activa ────────────────────────────────
        case "window":
        case "w": {
            const snap = ambientService.getSnapshot();
            if (!snap.activeWindow) return "No hay ventana activa detectada aún.";
            const hist = snap.windowHistory
                .slice(0, 8)
                .map((w, i) => `  ${i + 1}. **${w.app}** — "${w.title.slice(0, 70)}"`)
                .join("\n");
            return [
                `## Ventana Activa`,
                `**${snap.activeWindow.app}** — "${snap.activeWindow.title}"`,
                "",
                `**Historial (${snap.windowHistory.length} entradas):**`,
                hist,
            ].join("\n");
        }

        // ── clipboard: portapapeles ───────────────────────────────
        case "clipboard":
        case "cb":
        case "clip": {
            const snap = ambientService.getSnapshot();
            if (!snap.recentClipboard) return "Portapapeles vacío o sin cambios recientes.";
            const c = snap.recentClipboard;
            return [
                `## Portapapeles [${c.type}]`,
                `\`\`\``,
                c.text.slice(0, 1200),
                `\`\`\``,
            ].join("\n");
        }

        // ── downloads: descargas recientes ────────────────────────
        case "downloads":
        case "dl": {
            const snap = ambientService.getSnapshot();
            if (snap.recentDownloads.length === 0) return "No hay descargas recientes detectadas.";
            const dl = snap.recentDownloads
                .map(d => `  - **${d.file}** (*.${d.ext}*) — ${new Date(d.ts).toLocaleTimeString("es-MX")}`)
                .join("\n");
            return `## Descargas Recientes\n${dl}`;
        }

        // ── status: resumen general ───────────────────────────────
        case "status":
        default: {
            const snap   = ambientService.getSnapshot();
            const active = ambientService.isRunning();
            const badge  = active ? "🟢 Activo" : "🔴 Inactivo";

            const lines = [`## Ambient Awareness Engine — ${badge}`];

            if (active) {
                if (snap.activeWindow) {
                    lines.push(`\n**App activa:** \`${snap.activeWindow.app}\` — "${snap.activeWindow.title.slice(0, 60)}"`);
                }
                if (snap.recentClipboard) {
                    lines.push(`**Portapapeles:** [${snap.recentClipboard.type}] ${snap.recentClipboard.text.slice(0, 80).replace(/\n/g, " ")}…`);
                }
                if (snap.recentDownloads.length > 0) {
                    lines.push(`**Última descarga:** ${snap.recentDownloads[0].file}`);
                }
                lines.push(`\n*Historial de ventanas: ${snap.windowHistory.length} entradas*`);
                lines.push("\nUsa `/ambient window`, `/ambient clipboard`, `/ambient downloads` para más detalle.");
            } else {
                lines.push("\nEl motor no está activo.");
                lines.push("Opciones:");
                lines.push("  • `/ambient on` — activa ahora");
                lines.push("  • Edita `ambient.enabled: true` en `config/orbit.yaml` para activar al inicio");
            }

            return lines.join("\n");
        }
    }
}

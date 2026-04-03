/**
 * Orbit Tool: get_ambient_context — Sprint 9
 * ─────────────────────────────────────────────
 * Devuelve un snapshot legible de lo que el usuario está haciendo ahora mismo:
 *   - App/ventana activa
 *   - Historial de ventanas recientes
 *   - Último contenido del portapapeles
 *   - Descargas recientes
 *
 * Orbit puede llamar esta tool para tener contexto antes de responder.
 */

import { ambientService } from "../ambient/service.js";

export async function getAmbientContext(_args: any): Promise<string> {
    if (!ambientService.isRunning()) {
        return [
            "El motor de Ambient Awareness no está activo.",
            "Para activarlo añade `ambient.enabled: true` en config/orbit.yaml",
            "o usa el comando `/ambient on`.",
        ].join("\n");
    }

    const snap  = ambientService.getSnapshot();
    const lines: string[] = ["## Contexto Ambiental Actual\n"];

    // ── Ventana activa ────────────────────────────────────────────
    if (snap.activeWindow) {
        lines.push(`**App activa:** \`${snap.activeWindow.app}\``);
        lines.push(`**Título:** "${snap.activeWindow.title}"`);
    } else {
        lines.push("**App activa:** desconocida");
    }

    // ── Historial de ventanas ─────────────────────────────────────
    if (snap.windowHistory.length > 1) {
        const hist = snap.windowHistory
            .slice(0, 6)
            .map((w, i) => `  ${i + 1}. ${w.app} — "${w.title.slice(0, 70)}"`)
            .join("\n");
        lines.push(`\n**Ventanas recientes:**\n${hist}`);
    }

    // ── Portapapeles ──────────────────────────────────────────────
    if (snap.recentClipboard) {
        const c = snap.recentClipboard;
        const preview = c.text.slice(0, 600);
        lines.push(`\n**Portapapeles** [${c.type}]:\n\`\`\`\n${preview}\n\`\`\``);
    } else {
        lines.push("\n**Portapapeles:** vacío o sin cambios");
    }

    // ── Descargas recientes ───────────────────────────────────────
    if (snap.recentDownloads.length > 0) {
        const dl = snap.recentDownloads
            .map(d => `  - ${d.file} (*.${d.ext}*) — ${new Date(d.ts).toLocaleTimeString("es-MX")}`)
            .join("\n");
        lines.push(`\n**Descargas recientes:**\n${dl}`);
    }

    lines.push(`\n*Snapshot tomado: ${new Date(snap.lastUpdated).toLocaleTimeString("es-MX")}*`);
    return lines.join("\n");
}

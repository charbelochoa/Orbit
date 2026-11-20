/**
 * /model [<provider>]
 * Shows the active provider or switches to another at runtime.
 */

import { providerRegistry }    from "../../providers/registry.js";
import { broadcast }           from "../../gateway/server.js";
import { currentProviderSelection } from "../../providers/selection.js";
import type { CommandHandler } from "../types.js";

export const modelCommand: CommandHandler = async (ctx) => {
    const target = ctx.args[0]?.toLowerCase();

    // ── No arg → show current ────────────────────────────────────────────────
    if (!target) {
        const info      = providerRegistry.getActiveInfo();
        const available = providerRegistry.listAvailable();
        const selected = currentProviderSelection();
        return [
            `**Predeterminado de Orbit** ${info.name} (\`${info.id}\`)`,
            ...(info.model ? [`**Modelo de texto** \`${info.model}\``] : []),
            ...(selected ? [`**Sesión actual** \`${selected.providerId}\` · \`${selected.model}\``] : []),
            `**Modelos:** ${info.models.slice(0, 4).join(", ") || "—"}`,
            `**Disponibles:** ${available.join(", ") || "ninguno"}`,
            `\nUsa \`/model <id>\` para cambiar. IDs: gemini | openai | anthropic | ollama`,
        ].join("\n");
    }

    // ── Switch provider ───────────────────────────────────────────────────────
    try {
        providerRegistry.setActiveProvider(target);
        const info = providerRegistry.getActiveInfo();
        // Notify all UI clients of the change
        broadcast({ type: "provider_changed", provider: info.id, name: info.name, model: info.model });
        return `Proveedor predeterminado cambiado a **${info.name}** (\`${info.id}\`).`;
    } catch (e: any) {
        return String(e.message);
    }
};

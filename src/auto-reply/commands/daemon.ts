/**
 * /daemon install | uninstall | status | logs [N]
 * Controls the Windows autostart daemon from the chat UI.
 */

import { getDaemonService }    from "../../daemon/service.js";
import type { CommandHandler } from "../types.js";

export const daemonCommand: CommandHandler = async (ctx) => {
    const sub  = ctx.subcommand;
    const arg0 = ctx.argStr.trim();

    let svc: ReturnType<typeof getDaemonService>;
    try {
        svc = getDaemonService();
    } catch (e: any) {
        return `❌ ${e.message}`;
    }

    if (!sub || sub === "status") {
        const info = await svc.status();
        return [
            `**Daemon Orbit** — ${info.status.toUpperCase()}`,
            info.taskName ? `Tarea: ${info.taskName}` : "",
            info.nextRun  ? `Próxima ejecución: ${info.nextRun}` : "",
            info.lastRun  ? `Última ejecución:  ${info.lastRun}` : "",
            info.message  ?? "",
        ].filter(Boolean).join("\n");
    }

    if (sub === "install") {
        try {
            await svc.install();
            return "✅ Orbit instalado en Windows Task Scheduler. Se iniciará automáticamente al próximo inicio de sesión.";
        } catch (e: any) {
            return `❌ Error al instalar: ${e.message}`;
        }
    }

    if (sub === "uninstall") {
        try {
            await svc.uninstall();
            return "✅ Orbit eliminado de Windows Task Scheduler.";
        } catch (e: any) {
            return `❌ Error al desinstalar: ${e.message}`;
        }
    }

    if (sub === "logs") {
        const lines = parseInt(arg0, 10) || 100;
        const content = await svc.logs(lines);
        return `**Últimas ${lines} líneas del log:**\n\`\`\`\n${content.slice(-3000)}\n\`\`\``;
    }

    return "Subcomandos: status | install | uninstall | logs [N]";
};

#!/usr/bin/env node
/**
 * Orbit CLI — Phase 8
 * Usage:
 *   orbit install    → Register Orbit in Windows Task Scheduler (autostart on logon)
 *   orbit uninstall  → Remove the autostart task
 *   orbit status     → Show daemon / task status
 *   orbit logs [N]   → Print last N lines of today's log (default: 100)
 */

import { getDaemonService, DATA_DIR, LOGS_DIR } from "./daemon/service.js";

const HELP = `
Orbit AI — CLI (Phase 8)

  orbit install       Register autostart task (Windows Task Scheduler)
  orbit uninstall     Remove autostart task
  orbit status        Show current daemon status
  orbit logs [lines]  Print last N log lines (default: 100)
  orbit help          Show this message

Paths:
  Data dir: ${DATA_DIR}
  Logs dir: ${LOGS_DIR}
`.trim();

async function main() {
    const [, , cmd, ...rest] = process.argv;

    if (!cmd || cmd === "help" || cmd === "--help" || cmd === "-h") {
        console.log(HELP);
        process.exit(0);
    }

    const svc = getDaemonService();

    switch (cmd) {
        case "install": {
            console.log("Instalando Orbit en Windows Task Scheduler...");
            try {
                await svc.install();
                console.log("✅ Orbit instalado. Se iniciará automáticamente al próximo inicio de sesión.");
            } catch (e: any) {
                console.error("❌ Error al instalar:", e.message);
                process.exit(1);
            }
            break;
        }

        case "uninstall": {
            console.log("Desinstalando Orbit de Windows Task Scheduler...");
            try {
                await svc.uninstall();
                console.log("✅ Orbit desinstalado. Ya no se iniciará automáticamente.");
            } catch (e: any) {
                console.error("❌ Error al desinstalar:", e.message);
                process.exit(1);
            }
            break;
        }

        case "status": {
            const info = await svc.status();
            console.log(`Estado: ${info.status.toUpperCase()}`);
            if (info.taskName) console.log(`Tarea:  ${info.taskName}`);
            if (info.nextRun)  console.log(`Próxima ejecución: ${info.nextRun}`);
            if (info.lastRun)  console.log(`Última ejecución:  ${info.lastRun}`);
            if (info.message)  console.log(info.message);
            break;
        }

        case "logs": {
            const lines = parseInt(rest[0] ?? "100", 10) || 100;
            const content = await svc.logs(lines);
            console.log(content);
            break;
        }

        default: {
            console.error(`Comando desconocido: ${cmd}`);
            console.log(HELP);
            process.exit(1);
        }
    }
}

main().catch(e => {
    console.error("Error fatal:", e.message);
    process.exit(1);
});

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
import { spawn } from "node:child_process";

const desktop = process.env.ORBIT_DESKTOP_CLI === "1";

const DESKTOP_HELP = `
Orbit AI para Windows

  orbit.cmd start                Inicia Orbit o muestra la ventana existente
  orbit.cmd start --background   Inicia Orbit en la bandeja
  orbit.cmd chat [opciones]       Abre el chat interactivo de terminal
  orbit.cmd ask <mensaje>         Escribe una respuesta en stdout
  orbit.cmd help                 Muestra esta ayuda

Ejecuta orbit.cmd desde la carpeta de instalación, junto a Orbit AI.exe.
Configura el proveedor y el modelo desde Ajustes en la app de escritorio.
Usa chat --help y ask --help para ver las opciones de cada comando.
`.trim();

const SOURCE_HELP = `
Orbit AI — CLI

  orbit start         Inicia el agente y el panel local
  orbit chat          Interactive terminal chat (like Claude Code)
  orbit ask <message> Envía una solicitud y escribe la respuesta en stdout
  orbit install       Register autostart task (Windows Task Scheduler)
  orbit uninstall     Remove autostart task
  orbit status        Show current daemon status
  orbit logs [lines]  Print last N log lines (default: 100)
  orbit help          Show this message

Chat options:
  --provider <id>    Proveedor (gemini, openai, anthropic, ollama)
  --model-name <id>  Modelo de texto de ese proveedor
  --compact           Condensed logo
  --no-logo           Skip welcome banner
  --port <number>     Puerto del gateway
  --workspace <path>  Carpeta de trabajo
  --session <nombre> Retoma una sesión por nombre en esa carpeta
  --conversation <id> Retoma una conversación guardada

Ejecuta npm ci y npm run build desde el código fuente. Copia .env.example a
.env y ajusta ORBIT_PROVIDER y la clave del proveedor elegido. Para Ollama,
inicia su servidor local y configura OLLAMA_MODEL con un modelo instalado.

Inicia con npm run electron para usar la bandeja, o npm start para usar el
panel web. En otra terminal, ejecuta npm run cli -- chat.
Usa npm run build:windows para generar el instalador en dist-installer.

Rutas del servicio:
  Data dir: ${DATA_DIR}
  Logs dir: ${LOGS_DIR}
`.trim();

const HELP = desktop ? DESKTOP_HELP : SOURCE_HELP;

function startDesktop(args: string[]): Promise<void> {
    const env = { ...process.env };
    delete env.ELECTRON_RUN_AS_NODE;
    delete env.ORBIT_DESKTOP_CLI;
    return new Promise((resolve, reject) => {
        const child = spawn(process.execPath, args, { env, detached: true, stdio: "ignore" });
        child.once("error", reject);
        child.once("spawn", () => {
            child.unref();
            resolve();
        });
    });
}

async function main() {
    const [, , cmd, ...rest] = process.argv;

    if (!cmd || cmd === "help" || cmd === "--help" || cmd === "-h") {
        console.log(HELP);
        return;
    }

    if (desktop && !["start", "chat", "ask"].includes(cmd)) {
        console.error("Usa orbit.cmd help para ver los comandos de la instalación de Windows.");
        process.exitCode = 1;
        return;
    }

    switch (cmd) {
        case "start":
            if (desktop) await startDesktop(rest);
            else await import("./index.js");
            break;
        case "chat": {
            const { runChat } = await import("./cli-chat.js");
            await runChat(rest);
            break;
        }
        case "ask": {
            const { runAsk } = await import("./cli-ask.js");
            await runAsk(rest);
            break;
        }

        case "install": {
            console.log("Instalando Orbit en Windows Task Scheduler...");
            try {
                await getDaemonService().install();
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
                await getDaemonService().uninstall();
                console.log("✅ Orbit desinstalado. Ya no se iniciará automáticamente.");
            } catch (e: any) {
                console.error("❌ Error al desinstalar:", e.message);
                process.exit(1);
            }
            break;
        }

        case "status": {
            const info = await getDaemonService().status();
            console.log(`Estado: ${info.status.toUpperCase()}`);
            if (info.taskName) console.log(`Tarea:  ${info.taskName}`);
            if (info.nextRun)  console.log(`Próxima ejecución: ${info.nextRun}`);
            if (info.lastRun)  console.log(`Última ejecución:  ${info.lastRun}`);
            if (info.message)  console.log(info.message);
            break;
        }

        case "logs": {
            const lines = parseInt(rest[0] ?? "100", 10) || 100;
            const content = await getDaemonService().logs(lines);
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
    process.exitCode ||= 1;
});

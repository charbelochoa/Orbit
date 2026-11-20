import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { ORBIT_HOME, PROJECT_ROOT } from "../config/paths.js";
import { getConfig } from "../config/config.js";
import { TASK_NAME, currentLogFile, ensureDirs } from "./paths.js";
import type { DaemonInfo, DaemonService } from "./types.js";

const execute = promisify(execFile);
const sourceElectron = path.join(PROJECT_ROOT, "node_modules", "electron", "dist", "electron.exe");

async function taskScheduler(args: string[]): Promise<string> {
    const { stdout } = await execute("schtasks.exe", args, { windowsHide: true, timeout: 15_000 });
    return stdout.trim();
}

function xml(text: string): string {
    return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&apos;");
}

function buildTaskXml(executable: string, args: string): string {
    const username = os.userInfo().username;
    const domain = process.env.USERDOMAIN;
    const user = xml(domain ? `${domain}\\${username}` : username);
    return `<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.4" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo><Description>Orbit AI</Description></RegistrationInfo>
  <Triggers><LogonTrigger><Enabled>true</Enabled><UserId>${user}</UserId><Delay>PT1M</Delay></LogonTrigger></Triggers>
  <Principals><Principal id="OrbitUser"><UserId>${user}</UserId><LogonType>InteractiveToken</LogonType><RunLevel>LeastPrivilege</RunLevel></Principal></Principals>
  <Settings>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <ExecutionTimeLimit>PT0S</ExecutionTimeLimit>
    <RestartOnFailure><Interval>PT1M</Interval><Count>3</Count></RestartOnFailure>
  </Settings>
  <Actions Context="OrbitUser"><Exec>
    <Command>${xml(executable)}</Command>
    <Arguments>${xml(args)}</Arguments>
    <WorkingDirectory>${xml(path.dirname(executable))}</WorkingDirectory>
  </Exec></Actions>
</Task>`;
}

export class WindowsDaemonService implements DaemonService {
    async install(): Promise<void> {
        const installed = process.env.ORBIT_EXECUTABLE;
        const executable = installed ? path.resolve(installed) : sourceElectron;
        await fs.access(executable);
        if (!installed) await fs.access(path.join(PROJECT_ROOT, "dist", "index.js"));
        await ensureDirs();
        const temporary = path.join(os.tmpdir(), `orbit-task-${randomUUID()}.xml`);
        const args = installed ? "--background" : `"${path.resolve(PROJECT_ROOT)}" --background`;
        try {
            await fs.writeFile(temporary, Buffer.from("\uFEFF" + buildTaskXml(executable, args), "utf16le"), { flag: "wx" });
            await taskScheduler(["/Create", "/XML", temporary, "/TN", TASK_NAME, "/F"]);
        } finally {
            await fs.unlink(temporary).catch(() => {});
        }
    }

    async uninstall(): Promise<void> {
        await taskScheduler(["/Delete", "/TN", TASK_NAME, "/F"]);
    }

    async status(): Promise<DaemonInfo> {
        const { webPort } = getConfig().server;
        try {
            const response = await fetch(`http://127.0.0.1:${webPort}/health`, { signal: AbortSignal.timeout(800) });
            if (response.ok && (await response.json()).service === "orbit") {
                return { status: "running", taskName: TASK_NAME, message: "El agente local de Orbit está activo." };
            }
        } catch {}

        try {
            await taskScheduler(["/Query", "/TN", TASK_NAME]);
            return { status: "stopped", taskName: TASK_NAME, message: "El inicio con Windows está configurado." };
        } catch {
            return { status: "stopped", message: "Orbit está cerrado. El inicio con Windows no está configurado en el Programador de tareas." };
        }
    }

    async logs(lines = 100): Promise<string> {
        const activeLog = path.join(ORBIT_HOME, "logs", "backend.log");
        for (const filename of [activeLog, currentLogFile()]) {
            try {
                const file = await fs.open(filename, "r");
                try {
                    const { size } = await file.stat();
                    const length = Math.min(size, 256 * 1024);
                    const { buffer, bytesRead } = await file.read(Buffer.alloc(length), 0, length, size - length);
                    return buffer.subarray(0, bytesRead).toString("utf-8").split(/\r?\n/).slice(-Math.max(1, lines)).join("\n");
                } finally {
                    await file.close();
                }
            } catch {}
        }
        return `No se encontró el archivo de registro: ${activeLog}`;
    }
}

/**
 * Orbit Daemon — Windows Task Scheduler (Phase 8)
 *
 * Uses `schtasks.exe` to register / query / remove an ONLOGON task that
 * launches Orbit automatically when the user signs in.
 *
 * Schedule:
 *   - Trigger:  ONLOGON (current user)
 *   - Delay:    1 minute after logon (lets the desktop settle)
 *   - Restart:  on failure — 3 attempts, 1 min between each
 *   - Run as:   current user (IT flag — interactive)
 */

import { exec }     from "child_process";
import { promisify } from "util";
import path          from "path";
import fs            from "fs/promises";
import { fileURLToPath } from "url";
import { TASK_NAME, LOGS_DIR, currentLogFile, ensureDirs } from "./paths.js";
import type { DaemonInfo, DaemonService }                   from "./types.js";

const execAsync = promisify(exec);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Orbit project root (two levels up from src/daemon/)
const ORBIT_ROOT  = path.resolve(__dirname, "../../");
const ELECTRON_EXE = path.join(ORBIT_ROOT, "node_modules", ".bin", "electron.cmd");
const MAIN_CJS     = path.join(ORBIT_ROOT, "electron", "main.cjs");

// ── Helpers ───────────────────────────────────────────────────────────────────

async function run(cmd: string): Promise<string> {
    const { stdout, stderr } = await execAsync(cmd, { windowsHide: true });
    return (stdout + stderr).trim();
}

// ── XML task definition (more control than CLI flags) ────────────────────────

function buildTaskXml(taskRun: string, logFile: string): string {
    const userId = `${process.env.USERDOMAIN ?? ""}\\${process.env.USERNAME ?? ""}`.replace(/^\\/, "");
    return `<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.4" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo>
    <Description>Orbit AI — Local Desktop Assistant</Description>
  </RegistrationInfo>
  <Triggers>
    <LogonTrigger>
      <Enabled>true</Enabled>
      <UserId>${userId}</UserId>
      <Delay>PT1M</Delay>
    </LogonTrigger>
  </Triggers>
  <Principals>
    <Principal id="Author">
      <UserId>${userId}</UserId>
      <LogonType>InteractiveToken</LogonType>
      <RunLevel>LeastPrivilege</RunLevel>
    </Principal>
  </Principals>
  <Settings>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <ExecutionTimeLimit>PT0S</ExecutionTimeLimit>
    <RestartOnFailure>
      <Interval>PT1M</Interval>
      <Count>3</Count>
    </RestartOnFailure>
    <Enabled>true</Enabled>
    <RunOnlyIfNetworkAvailable>false</RunOnlyIfNetworkAvailable>
  </Settings>
  <Actions Context="Author">
    <Exec>
      <Command>${taskRun.replace(/&/g, "&amp;")}</Command>
      <Arguments>"${MAIN_CJS.replace(/&/g, "&amp;")}"</Arguments>
      <WorkingDirectory>${ORBIT_ROOT.replace(/&/g, "&amp;")}</WorkingDirectory>
    </Exec>
  </Actions>
</Task>`;
}

// ── WindowsDaemonService ──────────────────────────────────────────────────────

export class WindowsDaemonService implements DaemonService {

    async install(): Promise<void> {
        await ensureDirs();

        // Prefer the local electron binary; fall back to global `electron`
        let taskRun = ELECTRON_EXE;
        try {
            await fs.access(ELECTRON_EXE);
        } catch {
            taskRun = "electron";
        }

        const logFile = currentLogFile();
        const xml     = buildTaskXml(taskRun, logFile);

        // Write XML to a temp file and import it
        const tmpXml  = path.join(ORBIT_ROOT, ".orbit-task.xml");
        await fs.writeFile(tmpXml, Buffer.from("\xFF\xFE" + xml, "binary")); // UTF-16 LE BOM

        try {
            await run(`schtasks /Create /XML "${tmpXml}" /TN "${TASK_NAME}" /F`);
        } finally {
            await fs.unlink(tmpXml).catch(() => {});
        }
    }

    async uninstall(): Promise<void> {
        await run(`schtasks /Delete /TN "${TASK_NAME}" /F`);
    }

    async status(): Promise<DaemonInfo> {
        try {
            const out = await run(`schtasks /Query /TN "${TASK_NAME}" /FO CSV /NH`);
            if (!out.includes(TASK_NAME)) {
                return { status: "stopped", message: "Tarea no existe en Task Scheduler." };
            }
            // CSV: "TaskName","Next Run Time","Status","Last Run Time","Last Result"
            const cols = out.split(",").map(c => c.replace(/^"|"$/g, "").trim());
            const taskStatus = (cols[2] ?? "").toLowerCase();
            return {
                status:   taskStatus.includes("running") ? "running" : "stopped",
                taskName: TASK_NAME,
                nextRun:  cols[1],
                lastRun:  cols[3],
                message:  `Estado: ${cols[2] ?? "desconocido"}`,
            };
        } catch {
            return { status: "unknown", message: `Tarea "${TASK_NAME}" no encontrada. Instala con: orbit install` };
        }
    }

    async logs(lines = 100): Promise<string> {
        const logFile = currentLogFile();
        try {
            const content = await fs.readFile(logFile, "utf-8");
            const all = content.split("\n");
            return all.slice(-lines).join("\n");
        } catch {
            return `No se encontró el archivo de log: ${logFile}`;
        }
    }
}

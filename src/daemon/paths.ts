/**
 * Orbit Daemon — Paths (Phase 8)
 * Resolves all data/log directories for the Orbit daemon.
 * On Windows: %APPDATA%\Orbit\  (C:\Users\<user>\AppData\Roaming\Orbit)
 */

import path from "path";
import fs   from "fs/promises";
import os   from "os";

const APP_NAME = "Orbit";

// ── Root dirs ─────────────────────────────────────────────────────────────────

/** %APPDATA%\Orbit  (roaming — survives across profiles) */
export const DATA_DIR  = path.join(process.env.APPDATA ?? path.join(os.homedir(), "AppData", "Roaming"), APP_NAME);

/** Directory for rotating log files */
export const LOGS_DIR  = path.join(DATA_DIR, "logs");

/** PID file / lock file */
export const PID_FILE  = path.join(DATA_DIR, "orbit.pid");

/** Name used for the Windows Task Scheduler task */
export const TASK_NAME = "Orbit AI";

// ── Helpers ───────────────────────────────────────────────────────────────────

export async function ensureDirs(): Promise<void> {
    await fs.mkdir(LOGS_DIR, { recursive: true });
}

export function currentLogFile(): string {
    const d = new Date();
    const stamp = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    return path.join(LOGS_DIR, `orbit-${stamp}.log`);
}

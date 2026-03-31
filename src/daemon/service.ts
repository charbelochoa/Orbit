/**
 * Orbit Daemon — Service Dispatcher (Phase 8)
 * Selects the correct platform implementation.
 * Currently only Windows is supported.
 */

import { WindowsDaemonService } from "./windows.js";
import type { DaemonService }   from "./types.js";

export type { DaemonService, DaemonInfo, DaemonStatus } from "./types.js";
export { DATA_DIR, LOGS_DIR, TASK_NAME, currentLogFile } from "./paths.js";

/** Returns the correct daemon service for the current OS. */
export function getDaemonService(): DaemonService {
    if (process.platform === "win32") {
        return new WindowsDaemonService();
    }
    throw new Error(`Daemon autostart is only supported on Windows. Platform: ${process.platform}`);
}

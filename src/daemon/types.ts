/**
 * Orbit Daemon — Types (Phase 8)
 */

export type DaemonStatus = "running" | "stopped" | "unknown" | "error";

export interface DaemonInfo {
    status:    DaemonStatus;
    taskName?: string;
    nextRun?:  string;
    lastRun?:  string;
    message?:  string;
}

export interface DaemonService {
    install():   Promise<void>;
    uninstall(): Promise<void>;
    status():    Promise<DaemonInfo>;
    logs(lines?: number): Promise<string>;
}

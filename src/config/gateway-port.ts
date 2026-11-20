import { readFile } from "node:fs/promises";
import path from "node:path";
import { getConfig } from "./config.js";
import { ORBIT_HOME } from "./paths.js";

function validPort(value: unknown): value is number {
    return typeof value === "number" && Number.isInteger(value) && value >= 1024 && value <= 65535;
}

export async function resolveGatewayPort(requested?: number): Promise<number> {
    if (requested !== undefined) {
        if (!validPort(requested)) throw new Error("Puerto del gateway inválido.");
        return requested;
    }

    try {
        const runtime = JSON.parse(await readFile(path.join(ORBIT_HOME, ".orbit", "desktop-runtime.json"), "utf8"));
        if (typeof runtime?.runtimeId === "string" && validPort(runtime.webPort) && validPort(runtime.gatewayPort)) {
            const response = await fetch(`http://127.0.0.1:${runtime.webPort}/health`, {
                signal: AbortSignal.timeout(1000), redirect: "error",
            });
            if (response.ok) {
                const health = await response.json();
                if (health?.service === "orbit" && health.runtimeId === runtime.runtimeId && health.gatewayPort === runtime.gatewayPort) {
                    return runtime.gatewayPort;
                }
            }
        }
    } catch {}

    return getConfig().server.gatewayPort;
}

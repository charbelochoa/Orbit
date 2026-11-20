/**
 * /doctor — Diagnóstico del sistema Orbit
 */
import { execSync } from "child_process";
import fs from "fs";
import path from "path";
import { getConfig } from "../../config/config.js";
import { providerRegistry } from "../../providers/registry.js";
import type { CommandHandler } from "../types.js";

function check(label: string, fn: () => string | boolean): string {
    try {
        const result = fn();
        if (result === true || (typeof result === "string" && result)) {
            const detail = typeof result === "string" ? ` (${result})` : "";
            return `  ✓ ${label}${detail}`;
        }
        return `  ✗ ${label}`;
    } catch {
        return `  ✗ ${label}`;
    }
}

export const doctorCommand: CommandHandler = async (_ctx) => {
    const lines: string[] = ["**Orbit Doctor — Diagnóstico del sistema**\n"];

    // Node.js version
    lines.push(check("Node.js", () => process.version));

    // npm version
    lines.push(check("npm", () => execSync("npm --version", { encoding: "utf-8" }).trim()));

    // Git
    lines.push(check("Git", () => execSync("git --version", { encoding: "utf-8" }).trim().replace("git version ", "")));

    const config = getConfig();
    const active = providerRegistry.getActiveInfo();
    lines.push(check("Gateway", () => String(config.server.gatewayPort)));
    lines.push(check("Modelo activo", () => active.model ? `${active.name} · ${active.model}` : false));
    lines.push(check("GEMINI_API_KEY", () => Boolean(config.providers.gemini.apiKey)));
    lines.push(check("OPENAI_API_KEY", () => Boolean(config.providers.openai.apiKey)));
    lines.push(check("ANTHROPIC_API_KEY", () => Boolean(config.providers.anthropic.apiKey)));

    // ORBIT.md
    const orbitMd = path.join(process.cwd(), "ORBIT.md");
    lines.push(check("ORBIT.md en el proyecto", () => fs.existsSync(orbitMd)));

    // config/orbit.yaml
    const configPath = path.join(process.cwd(), "config", "orbit.yaml");
    lines.push(check("config/orbit.yaml", () => fs.existsSync(configPath)));

    // package.json (is a project)
    const pkgPath = path.join(process.cwd(), "package.json");
    lines.push(check("package.json del proyecto", () => fs.existsSync(pkgPath)));

    // TypeScript
    lines.push(check("TypeScript", () => {
        const v = execSync("npx tsc --version", { encoding: "utf-8" }).trim();
        return v.replace("Version ", "");
    }));

    // Disk space (Windows)
    try {
        const drive = process.cwd().slice(0, 2);
        const info = execSync(`wmic logicaldisk where "DeviceID='${drive}'" get FreeSpace /value`, {
            encoding: "utf-8",
        }).trim();
        const free = parseInt(info.replace("FreeSpace=", ""), 10);
        if (!isNaN(free)) {
            const gb = (free / (1024 ** 3)).toFixed(1);
            lines.push(check("Espacio libre en disco", () => `${gb} GB`));
        }
    } catch { /* non-Windows or error */ }

    lines.push("");
    return lines.join("\n");
};

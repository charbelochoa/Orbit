import { exec } from "child_process";
import { promisify } from "util";
import { existsSync } from "fs";

const execAsync = promisify(exec);

// ── Security: sanitize strings for use in PowerShell via -EncodedCommand ─────
function psEncodedCommand(script: string): string {
    const encoded = Buffer.from(script, "utf16le").toString("base64");
    return `powershell -NoProfile -NonInteractive -EncodedCommand ${encoded}`;
}

/** Validate app name: only allows safe characters for Windows app names */
function isSafeAppName(name: string): boolean {
    // Allow letters, digits, spaces, hyphens, dots, underscores, parentheses, accented chars
    return /^[\w\s.\-()\u00C0-\u024F]+$/u.test(name) && name.length <= 120;
}

const APP_ALIASES: Record<string, string> = {
    "chrome":       "Google Chrome",
    "google chrome": "Google Chrome",
    "edge":         "Microsoft Edge",
    "firefox":      "Firefox",
    "opera":        "Opera",
    "brave":        "Brave",
    "vivaldi":      "Vivaldi",
    "vscode":       "Visual Studio Code",
    "code":         "Visual Studio Code",
    "visual studio code": "Visual Studio Code",
    "notepad":      "notepad",
    "notepad++":    "notepad++",
    "discord":      "Discord",
    "spotify":      "Spotify",
    "steam":        "Steam",
    "epic games":   "Epic Games Launcher",
    "whatsapp":     "WhatsApp",
    "telegram":     "Telegram",
    "slack":        "Slack",
    "teams":        "Microsoft Teams",
    "word":         "Word",
    "excel":        "Excel",
    "powerpoint":   "PowerPoint",
    "outlook":      "Outlook",
    "onenote":      "OneNote",
    "calculator":   "calc",
    "calculadora":  "calc",
    "paint":        "mspaint",
    "explorer":     "explorer",
    "explorador":   "explorer",
    "terminal":     "wt",
    "cmd":          "cmd",
    "powershell":   "powershell",
    "settings":     "ms-settings:",
    "configuracion": "ms-settings:",
    "configuración": "ms-settings:",
    "task manager":  "taskmgr",
    "administrador de tareas": "taskmgr",
    "snipping tool": "snippingtool",
    "recortes":     "snippingtool",
    "obs":          "OBS Studio",
    "vlc":          "VLC media player",
    "zoom":         "Zoom",
    "figma":        "Figma",
    "postman":      "Postman",
    "gimp":         "GIMP",
    "blender":      "Blender",
    "obs studio":   "OBS Studio",
};

// Direct-launch apps — exe names or 'start' shortcuts that work on Windows
const DIRECT_LAUNCH: Record<string, string> = {
    "notepad":      "notepad.exe",
    "calc":         "calc.exe",
    "mspaint":      "mspaint.exe",
    "explorer":     "explorer.exe",
    "wt":           "wt.exe",
    "cmd":          "cmd.exe",
    "powershell":   "powershell.exe",
    "taskmgr":      "taskmgr.exe",
    "snippingtool": "snippingtool.exe",
};

// Apps that MUST launch via Start Menu shortcut (.lnk) to trigger native behavior
// (e.g. Chrome/Edge profile picker). These skip `start <exe>` entirely.
const LAUNCH_VIA_SHORTCUT = new Set([
    "Google Chrome", "Microsoft Edge", "Firefox", "Opera", "Brave", "Vivaldi",
]);

// Known `start` shortcuts (Windows shell recognizes these)
const START_SHORTCUTS: Record<string, string> = {
    "Discord":          "discord",
    "Spotify":          "spotify",
    "Slack":            "slack",
    "Microsoft Teams":  "msteams",
    "Word":             "winword",
    "Excel":            "excel",
    "PowerPoint":       "powerpnt",
    "Outlook":          "outlook",
    "OneNote":          "onenote",
};

/**
 * Search Start Menu for a .lnk shortcut and launch it via Invoke-Item.
 * This triggers the native app behavior (e.g. Chrome profile picker).
 */
async function launchViaShortcut(name: string): Promise<boolean> {
    // Security: use -EncodedCommand to prevent PS injection
    const psCmd = `
$name = '${name.replace(/'/g, "''")}'
$lnk = Get-ChildItem "$env:ProgramData\\Microsoft\\Windows\\Start Menu","$env:APPDATA\\Microsoft\\Windows\\Start Menu" -Recurse -Filter '*.lnk' -ErrorAction SilentlyContinue |
  Where-Object { $_.BaseName -like "*$name*" } | Select-Object -First 1
if ($lnk) { Invoke-Item $lnk.FullName; Write-Output "OK" }
else { Write-Output "NOT_FOUND" }`;
    try {
        const { stdout } = await execAsync(
            psEncodedCommand(psCmd),
            { timeout: 10000 }
        );
        return stdout.trim() === "OK";
    } catch {
        return false;
    }
}

export async function openApp(parameters: any): Promise<string> {
    const rawName = (parameters?.app_name || parameters?.app || "").trim();
    if (!rawName) return "Necesito el nombre de la aplicacion a abrir.";
    if (!isSafeAppName(rawName)) return `Nombre de aplicación no permitido: "${rawName.slice(0, 40)}".`;
    console.log(`[Open App] Abriendo: ${rawName}`);
    try {
        // Resolve alias
        const resolved = APP_ALIASES[rawName.toLowerCase()] || rawName;
        // ms-settings: and similar URI schemes
        if (resolved.includes(":")) {
            await execAsync(`start "" "${resolved}"`, { timeout: 5000 });
            return `Abriendo ${rawName}.`;
        }
        // Direct executable launch
        const directExe = DIRECT_LAUNCH[resolved.toLowerCase()] || DIRECT_LAUNCH[resolved];
        if (directExe) {
            await execAsync(`start "" "${directExe}"`, { timeout: 5000 });
            return `${rawName} abierto.`;
        }
        // Apps that need shortcut launch (e.g. Chrome profile picker)
        if (LAUNCH_VIA_SHORTCUT.has(resolved)) {
            const launched = await launchViaShortcut(resolved);
            if (launched) return `${rawName} abierto.`;
            // If shortcut not found, fall through to other methods
        }
        // Known start shortcuts (most reliable on Windows)
        const shortcut = START_SHORTCUTS[resolved];
        if (shortcut) {
            await execAsync(`start ${shortcut}`, { timeout: 8000 });
            return `${rawName} abierto.`;
        }
        // Try Start-Process with resolved name (PowerShell) — use -EncodedCommand
        try {
            await execAsync(
                psEncodedCommand(`Start-Process '${resolved.replace(/'/g, "''")}'`),
                { timeout: 8000 }
            );
            return `${rawName} abierto.`;
        } catch {}
        // Fallback: search in Start Menu shortcuts
        const launched = await launchViaShortcut(resolved);
        if (launched) return `${rawName} abierto (via Start Menu).`;
        // Fallback: try known exe paths for common apps
        const knownPaths = getKnownExePaths(resolved);
        for (const exePath of knownPaths) {
            if (existsSync(exePath)) {
                await execAsync(`start "" "${exePath}"`, { timeout: 8000 });
                return `${rawName} abierto.`;
            }
        }
        return `No encontre "${rawName}" en el sistema. Revisa que este instalado.`;
    } catch (e: any) {
        console.error(`[Open App] `, e);
        return `Error abriendo ${rawName}: ${e.message}`;
    }
}

function getKnownExePaths(resolved: string): string[] {
    const pf = process.env["ProgramFiles"] || "C:\\Program Files";
    const pf86 = process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)";
    const local = process.env["LOCALAPPDATA"] || "";
    const map: Record<string, string[]> = {
        "Google Chrome": [
            `${pf}\\Google\\Chrome\\Application\\chrome.exe`,
            `${pf86}\\Google\\Chrome\\Application\\chrome.exe`,
            `${local}\\Google\\Chrome\\Application\\chrome.exe`,
        ],
        "Microsoft Edge": [
            `${pf86}\\Microsoft\\Edge\\Application\\msedge.exe`,
            `${pf}\\Microsoft\\Edge\\Application\\msedge.exe`,
        ],
        "Firefox": [
            `${pf}\\Mozilla Firefox\\firefox.exe`,
            `${pf86}\\Mozilla Firefox\\firefox.exe`,
        ],
        "Brave": [
            `${pf}\\BraveSoftware\\Brave-Browser\\Application\\brave.exe`,
            `${pf86}\\BraveSoftware\\Brave-Browser\\Application\\brave.exe`,
            `${local}\\BraveSoftware\\Brave-Browser\\Application\\brave.exe`,
        ],
        "Opera": [
            `${local}\\Programs\\Opera\\launcher.exe`,
        ],
        "Vivaldi": [
            `${local}\\Vivaldi\\Application\\vivaldi.exe`,
        ],
        "Visual Studio Code": [
            `${local}\\Programs\\Microsoft VS Code\\Code.exe`,
            `${pf}\\Microsoft VS Code\\Code.exe`,
        ],
        "Discord": [
            `${local}\\Discord\\Update.exe`,
        ],
        "Spotify": [
            `${local}\\Microsoft\\WindowsApps\\Spotify.exe`,
            `${local}\\Spotify\\Spotify.exe`,
        ],
        "WhatsApp": [
            `${local}\\Microsoft\\WindowsApps\\WhatsApp.exe`,
        ],
        "Telegram": [
            `${local}\\Telegram Desktop\\Telegram.exe`,
        ],
    };
    return map[resolved] || [];
}
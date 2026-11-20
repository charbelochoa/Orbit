import { exec } from "child_process";
import { promisify } from "util";
import { generateText } from "../providers/registry.js";

const execAsync = promisify(exec);

async function runPS(script: string, timeout = 10000): Promise<string> {
    const escaped = script.replace(/"/g, '\\"');
    const { stdout } = await execAsync(
        `powershell -NoProfile -NonInteractive -Command "${escaped}"`,
        { timeout }
    );
    return (stdout || "").trim();
}

// ── Direct action handlers ──────────────────────────────────────────────────

async function volumeUp(amount: number = 10): Promise<string> {
    const steps = Math.round(amount / 2);
    const script = `
$wsh = New-Object -ComObject WScript.Shell;
1..${steps} | ForEach-Object { $wsh.SendKeys([char]175) };
Write-Output "ok"`;
    await runPS(script);
    return `Volumen subido ~${amount}%.`;
}

async function volumeDown(amount: number = 10): Promise<string> {
    const steps = Math.round(amount / 2);
    const script = `
$wsh = New-Object -ComObject WScript.Shell;
1..${steps} | ForEach-Object { $wsh.SendKeys([char]174) };
Write-Output "ok"`;
    await runPS(script);
    return `Volumen bajado ~${amount}%.`;
}

async function volumeMute(): Promise<string> {
    const script = `$wsh = New-Object -ComObject WScript.Shell; $wsh.SendKeys([char]173); Write-Output "ok"`;
    await runPS(script);
    return "Volumen muteado/desmuteado.";
}

async function volumeSet(value: number): Promise<string> {
    const clamped = Math.max(0, Math.min(100, value));
    const script = `
Add-Type -TypeDefinition @"
using System; using System.Runtime.InteropServices;
public class Vol {
    [DllImport("winmm.dll")] public static extern int waveOutSetVolume(IntPtr h, uint v);
}
"@ -ErrorAction SilentlyContinue;
$v = [Math]::Round(${clamped} / 100.0 * 65535);
$both = $v -bor ($v -shl 16);
[Vol]::waveOutSetVolume([IntPtr]::Zero, $both);
Write-Output "ok"`;
    await runPS(script);
    return `Volumen establecido a ${clamped}%.`;
}

async function brightnessSet(value: number): Promise<string> {
    const clamped = Math.max(0, Math.min(100, value));
    const script = `(Get-WmiObject -Namespace root/WMI -Class WmiMonitorBrightnessMethods).WmiSetBrightness(1,${clamped}); Write-Output "ok"`;
    await runPS(script);
    return `Brillo establecido a ${clamped}%.`;
}

async function brightnessUp(amount: number = 10): Promise<string> {
    const script = `
$cur = (Get-WmiObject -Namespace root/WMI -Class WmiMonitorBrightness).CurrentBrightness;
$new = [Math]::Min(100, $cur + ${amount});
(Get-WmiObject -Namespace root/WMI -Class WmiMonitorBrightnessMethods).WmiSetBrightness(1,$new);
Write-Output "Brillo: $new%"`;
    const result = await runPS(script);
    return result || `Brillo subido ${amount}%.`;
}

async function brightnessDown(amount: number = 10): Promise<string> {
    const script = `
$cur = (Get-WmiObject -Namespace root/WMI -Class WmiMonitorBrightness).CurrentBrightness;
$new = [Math]::Max(0, $cur - ${amount});
(Get-WmiObject -Namespace root/WMI -Class WmiMonitorBrightnessMethods).WmiSetBrightness(1,$new);
Write-Output "Brillo: $new%"`;
    const result = await runPS(script);
    return result || `Brillo bajado ${amount}%.`;
}

async function closeApp(appName: string): Promise<string> {
    const name = appName.trim().replace(/\.exe$/i, "");
    if (!/^[a-zA-Z0-9._ -]{1,120}$/.test(name)) return "Error: indica el nombre de la aplicación que deseas cerrar.";
    const result = await runPS(`
$windows = @(Get-Process -Name '${name}' -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 })
$requested = @($windows | Where-Object { $_.CloseMainWindow() })
Write-Output $requested.Count`);
    return Number(result) > 0 ? `Cierre solicitado para '${name}'.` : `Error: no encontré una ventana de '${name}' para cerrar.`;
}

async function minimizeWindow(): Promise<string> {
    await runPS(`Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait("%(n)"); Write-Output "ok"`);
    return "Ventana minimizada.";
}

async function maximizeWindow(): Promise<string> {
    await runPS(`Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait("%(x)"); Write-Output "ok"`);
    return "Ventana maximizada.";
}

async function snapLeft(): Promise<string> {
    await runPS(`Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait("#{LEFT}"); Write-Output "ok"`);
    return "Ventana ajustada a la izquierda.";
}

async function snapRight(): Promise<string> {
    await runPS(`Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait("#{RIGHT}"); Write-Output "ok"`);
    return "Ventana ajustada a la derecha.";
}

async function showDesktop(): Promise<string> {
    await runPS(`Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait("#{d}"); Write-Output "ok"`);
    return "Escritorio mostrado.";
}

async function switchWindow(): Promise<string> {
    await runPS(`Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait("%{TAB}"); Write-Output "ok"`);
    return "Cambio de ventana activado.";
}

async function fullScreen(): Promise<string> {
    await runPS(`Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait("{F11}"); Write-Output "ok"`);
    return "Pantalla completa toggled.";
}

// ── Intent detection with LLM ───────────────────────────────────────────────

const KNOWN_ACTIONS: Record<string, (value?: number, app?: string) => Promise<string>> = {
    "volume_up":       (v) => volumeUp(v),
    "volume_down":     (v) => volumeDown(v),
    "volume_mute":     () => volumeMute(),
    "volume_set":      (v) => volumeSet(v || 50),
    "brightness_up":   (v) => brightnessUp(v),
    "brightness_down": (v) => brightnessDown(v),
    "brightness_set":  (v) => brightnessSet(v || 50),
    "close_app":       (_v, app) => closeApp(app || ""),
    "minimize":        () => minimizeWindow(),
    "maximize":        () => maximizeWindow(),
    "snap_left":       () => snapLeft(),
    "snap_right":      () => snapRight(),
    "show_desktop":    () => showDesktop(),
    "switch_window":   () => switchWindow(),
    "full_screen":     () => fullScreen(),
};

async function detectIntent(task: string, signal?: AbortSignal): Promise<{ action: string; value?: number; app?: string }> {
    const actions = Object.keys(KNOWN_ACTIONS).join(", ");
    const response = await generateText({
        systemPrompt: `Classify the computer setting requested by the user. Actions are ${actions}. Return JSON with action, optional numeric value, and optional app name.`,
        messages: [{ role: "user", content: task }],
        responseFormat: "json",
        maxTokens: 300,
        signal,
    });
    let text = response.text || "{}";
    text = text.replace(/```(json)?/gi, "").trim();
    return JSON.parse(text);
}

// ── Main export ──────────────────────────────────────────────────────────────

export async function computerSettings(parameters: any, signal?: AbortSignal): Promise<string> {
    const action = (parameters?.action ?? "").toLowerCase().replace(/\s+/g, "_").trim();
    const value  = parameters?.value != null ? Number(parameters.value) : undefined;
    const app    = parameters?.app || parameters?.app_name || "";
    const task   = parameters?.task || "";

    console.log(`[Computer Settings] ${action || task}`, parameters);
    try {
        signal?.throwIfAborted();
        if (Object.hasOwn(KNOWN_ACTIONS, action)) {
            return await KNOWN_ACTIONS[action](value, app);
        }
        // LLM intent detection for natural language requests
        if (task || action) {
            const intent = await detectIntent(task || action, signal);
            signal?.throwIfAborted();
            if (typeof intent?.action === "string" && Object.hasOwn(KNOWN_ACTIONS, intent.action)) {
                const requestedValue = typeof intent.value === "number" && Number.isFinite(intent.value) ? intent.value : value;
                const requestedApp = typeof intent.app === "string" ? intent.app : app;
                return await KNOWN_ACTIONS[intent.action](requestedValue, requestedApp);
            }
        }
        return `Accion no reconocida: '${action || task}'. Disponibles: ${Object.keys(KNOWN_ACTIONS).join(", ")}`;
    } catch (e: any) {
        signal?.throwIfAborted();
        console.error(`[Computer Settings] `, e);
        return `Error en computer_settings: ${e.message}`;
    }
}

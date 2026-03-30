import { exec, spawn } from "child_process";
import { promisify } from "util";
import screenshot from "screenshot-desktop";
import path from "path";
import os from "os";
import fs from "fs/promises";

const execAsync = promisify(exec);

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Gaussian jitter: small random offset for human-like imprecision */
function jitter(px: number = 3): number {
    let u = 0, v = 0;
    while (u === 0) u = Math.random();
    while (v === 0) v = Math.random();
    return Math.floor(Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v) * px);
}

/** Quadratic Bézier + smoothstep easing, returns list of (x,y) points */
function bezierPoints(
    x0: number, y0: number,
    x1: number, y1: number,
    steps: number = 40
): Array<[number, number]> {
    // Perpendicular control point displaced by ±30% of distance
    const dx = x1 - x0;
    const dy = y1 - y0;
    const mid_x = (x0 + x1) / 2 + (-dy * 0.28 + jitter(8));
    const mid_y = (y0 + y1) / 2 + ( dx * 0.28 + jitter(8));

    const pts: Array<[number, number]> = [];
    for (let i = 0; i <= steps; i++) {
        const t_raw = i / steps;
        // Smoothstep easing: 3t²−2t³
        const t = t_raw * t_raw * (3 - 2 * t_raw);
        const px = Math.round((1 - t) * (1 - t) * x0 + 2 * (1 - t) * t * mid_x + t * t * x1);
        const py = Math.round((1 - t) * (1 - t) * y0 + 2 * (1 - t) * t * mid_y + t * t * y1);
        pts.push([px, py]);
    }
    return pts;
}

/** Build the mouse/keyboard PowerShell C# class (compiled once per script) */
const PS_MOUSE_CLASS = `
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public class OrbitInput {
    [DllImport("user32.dll")] public static extern bool SetCursorPos(int X, int Y);
    [DllImport("user32.dll")] public static extern void mouse_event(uint f, uint x, uint y, uint d, UIntPtr e);
    [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
    [DllImport("shcore.dll")]  public static extern int SetProcessDpiAwareness(int v);
    public const uint LBDN = 0x02, LBUP = 0x04, RBDN = 0x08, RBUP = 0x10, WHEEL = 0x0800;
    public static void Init()  { try { SetProcessDpiAwareness(2); } catch { SetProcessDPIAware(); } }
    public static void Move(int x, int y) { SetCursorPos(x, y); }
    public static void LClick() { mouse_event(LBDN,0,0,0,UIntPtr.Zero); System.Threading.Thread.Sleep(30); mouse_event(LBUP,0,0,0,UIntPtr.Zero); }
    public static void RClick() { mouse_event(RBDN,0,0,0,UIntPtr.Zero); System.Threading.Thread.Sleep(30); mouse_event(RBUP,0,0,0,UIntPtr.Zero); }
    public static void Scroll(int amt) { mouse_event(WHEEL,0,0,(uint)(amt*120),UIntPtr.Zero); }
}
"@ -ErrorAction SilentlyContinue
[OrbitInput]::Init();
`;

async function runPS(script: string): Promise<string> {
    const full = PS_MOUSE_CLASS + "\n" + script;
    const escaped = full.replace(/"/g, '\\"');
    try {
        const { stdout, stderr } = await execAsync(
            `powershell -NoProfile -NonInteractive -Command "${escaped}"`,
            { timeout: 30000 }
        );
        return (stdout || "").trim();
    } catch (e: any) {
        throw new Error(e.stderr?.trim() || e.message);
    }
}

// ─── Actions ──────────────────────────────────────────────────────────────────

/** Human-like Bézier mouse move. Returns script fragment (string) */
function buildBezierScript(x0: number, y0: number, x1: number, y1: number): string {
    const dist = Math.hypot(x1 - x0, y1 - y0);
    const steps = Math.max(20, Math.min(60, Math.round(dist / 12)));
    const pts = bezierPoints(x0, y0, x1 + jitter(2), y1 + jitter(2), steps);

    const delay = Math.max(2, Math.round(400 / steps)); // total ~400ms
    let script = `$pts = @(${pts.map(([x, y]) => `@(${x},${y})`).join(",")});\n`;
    script += `foreach ($p in $pts) { [OrbitInput]::Move($p[0], $p[1]); Start-Sleep -Milliseconds ${delay}; }\n`;
    return script;
}

/** Get current cursor position via PowerShell */
async function getCursorPos(): Promise<[number, number]> {
    try {
        const script = `
Add-Type -TypeDefinition @"
using System; using System.Runtime.InteropServices;
public class Cur { [DllImport("user32.dll")] public static extern bool GetCursorPos(out POINT p); }
public struct POINT { public int X, Y; }
"@ -ErrorAction SilentlyContinue
$p = New-Object POINT; [Cur]::GetCursorPos([ref]$p) | Out-Null; Write-Output "$($p.X),$($p.Y)"`;
        const { stdout } = await execAsync(`powershell -NoProfile -Command "${script.replace(/"/g, '\\"')}"`, { timeout: 5000 });
        const [x, y] = stdout.trim().split(",").map(Number);
        return [x || 0, y || 0];
    } catch {
        return [0, 0];
    }
}

// ─── Main Export ──────────────────────────────────────────────────────────────

export async function computerControl(parameters: any): Promise<string> {
    const action = (parameters?.action ?? "").toLowerCase().trim();
    if (!action) return "Especifica una acción: type, click, double_click, right_click, move, hotkey, press, scroll, screenshot, wait, focus_window, screen_find.";

    console.log(`[Computer Control] 🖱️  ${action}`, parameters);

    try {
        switch (action) {

            // ── Typing ─────────────────────────────────────────────────────
            case "type":
            case "smart_type": {
                const text: string = parameters.text || "";
                if (!text) return "Necesito el texto a escribir.";

                // Human-rhythm: escape for SendKeys, random delay 30-120ms per char
                const escaped = text
                    .replace(/[+^%~(){}[\]]/g, (c) => `{${c}}`) // SendKeys special chars
                    .replace(/\n/g, "{ENTER}")
                    .replace(/\t/g, "{TAB}");

                // Build char-by-char script with random intervals for human rhythm
                const delays: number[] = Array.from({ length: text.length }, () =>
                    30 + Math.floor(Math.random() * 90)
                );
                const script = `
Add-Type -AssemblyName System.Windows.Forms;
$chars = @(${escaped.split("").map((c, i) => `[PSCustomObject]@{c="${c.replace(/"/g, '`"')}";d=${delays[i]}}`).join(",")});
foreach ($item in $chars) {
    [System.Windows.Forms.SendKeys]::SendWait($item.c);
    Start-Sleep -Milliseconds $item.d;
}`;
                await execAsync(`powershell -NoProfile -Command "${script.replace(/"/g, '\\"')}"`, { timeout: 30000 });
                return `Texto escrito: "${text.slice(0, 40)}${text.length > 40 ? "…" : ""}"`;
            }

            // ── Click with Bézier move ─────────────────────────────────────
            case "click":
            case "left_click": {
                const x = Math.round(Number(parameters.x) || 0);
                const y = Math.round(Number(parameters.y) || 0);
                const [cx, cy] = await getCursorPos();
                const moveScript = buildBezierScript(cx, cy, x, y);
                await runPS(`${moveScript} [OrbitInput]::LClick(); Write-Output "ok"`);
                return `Click en (${x}, ${y})`;
            }

            case "double_click": {
                const x = Math.round(Number(parameters.x) || 0);
                const y = Math.round(Number(parameters.y) || 0);
                const [cx, cy] = await getCursorPos();
                const moveScript = buildBezierScript(cx, cy, x, y);
                await runPS(`${moveScript} [OrbitInput]::LClick(); Start-Sleep -Milliseconds 80; [OrbitInput]::LClick(); Write-Output "ok"`);
                return `Doble click en (${x}, ${y})`;
            }

            case "right_click": {
                const x = Math.round(Number(parameters.x) || 0);
                const y = Math.round(Number(parameters.y) || 0);
                const [cx, cy] = await getCursorPos();
                const moveScript = buildBezierScript(cx, cy, x, y);
                await runPS(`${moveScript} [OrbitInput]::RClick(); Write-Output "ok"`);
                return `Click derecho en (${x}, ${y})`;
            }

            // ── Mouse Move only ────────────────────────────────────────────
            case "move":
            case "mouse_move": {
                const x = Math.round(Number(parameters.x) || 0);
                const y = Math.round(Number(parameters.y) || 0);
                const [cx, cy] = await getCursorPos();
                const moveScript = buildBezierScript(cx, cy, x, y);
                await runPS(`${moveScript} Write-Output "ok"`);
                return `Ratón movido a (${x}, ${y})`;
            }

            // ── Scroll ─────────────────────────────────────────────────────
            case "scroll": {
                const dir = (parameters.direction || "down").toLowerCase();
                const amount = Number(parameters.amount) || 3;
                const scrollAmt = dir === "down" || dir === "right" ? -amount : amount;
                await runPS(`[OrbitInput]::Scroll(${scrollAmt}); Write-Output "ok"`);
                return `Scroll ${dir} x${amount}`;
            }

            // ── Hotkeys ────────────────────────────────────────────────────
            case "hotkey": {
                const keys: string = (parameters.keys || "ctrl+c").toLowerCase();
                // Map to SendKeys format: ^ = Ctrl, % = Alt, + = Shift
                let formatted = keys
                    .replace(/ctrl\+/g, "^")
                    .replace(/alt\+/g, "%")
                    .replace(/shift\+/g, "+")
                    .replace(/win\+/g, "^{ESC}"); // approximate

                // Wrap non-modifier final key if >1 char
                const parts = formatted.match(/[\^%+]*/g)?.join("") || "";
                const key = formatted.replace(/[\^%+]/g, "");
                if (key.length > 1) formatted = `${parts}{${key.toUpperCase()}}`;

                const script = `
Add-Type -AssemblyName System.Windows.Forms;
[System.Windows.Forms.SendKeys]::SendWait('${formatted}');`;
                await execAsync(`powershell -NoProfile -Command "${script.replace(/"/g, '\\"')}"`, { timeout: 10000 });
                return `Atajo ejecutado: ${keys}`;
            }

            // ── Single key press ───────────────────────────────────────────
            case "press": {
                const key: string = parameters.key || "enter";
                const keyMap: Record<string, string> = {
                    enter: "{ENTER}", tab: "{TAB}", escape: "{ESC}", esc: "{ESC}",
                    backspace: "{BS}", delete: "{DEL}", space: " ",
                    up: "{UP}", down: "{DOWN}", left: "{LEFT}", right: "{RIGHT}",
                    home: "{HOME}", end: "{END}", pgup: "{PGUP}", pgdn: "{PGDN}",
                    f1: "{F1}", f2: "{F2}", f3: "{F3}", f4: "{F4}", f5: "{F5}",
                    f6: "{F6}", f7: "{F7}", f8: "{F8}", f9: "{F9}", f10: "{F10}",
                    f11: "{F11}", f12: "{F12}",
                };
                const sendKey = keyMap[key.toLowerCase()] ?? `{${key.toUpperCase()}}`;
                const script = `
Add-Type -AssemblyName System.Windows.Forms;
[System.Windows.Forms.SendKeys]::SendWait('${sendKey}');`;
                await execAsync(`powershell -NoProfile -Command "${script.replace(/"/g, '\\"')}"`, { timeout: 10000 });
                return `Tecla pulsada: ${key}`;
            }

            // ── Screenshot ─────────────────────────────────────────────────
            case "screenshot": {
                const tempPath = path.join(os.tmpdir(), `orbit_ss_${Date.now()}.png`);
                await screenshot({ filename: tempPath });
                return `Captura de pantalla guardada en: ${tempPath}`;
            }

            // ── Wait ───────────────────────────────────────────────────────
            case "wait":
            case "sleep": {
                const secs = Math.min(Number(parameters.seconds) || 1, 30);
                await new Promise(r => setTimeout(r, secs * 1000));
                return `Esperé ${secs} segundos.`;
            }

            // ── Focus window ───────────────────────────────────────────────
            case "focus_window": {
                const appName: string = parameters.app || parameters.description || "";
                if (!appName) return "Necesito el nombre de la ventana.";
                const script = `
$wshell = New-Object -ComObject WScript.Shell;
$wshell.AppActivate('${appName}');`;
                await execAsync(`powershell -NoProfile -Command "${script.replace(/"/g, '\\"')}"`, { timeout: 8000 });
                return `Ventana activada: ${appName}`;
            }

            // ── Screen find / screen click (describe element) ──────────────
            case "screen_find":
            case "screen_click": {
                // These are handled via vision-control (YOLO) — pass through
                return `Acción '${action}' requiere el motor de visión. Usa vision_detect primero.`;
            }

            default:
                return `Acción no reconocida: '${action}'. Soportadas: type, click, double_click, right_click, move, hotkey, press, scroll, screenshot, wait, focus_window.`;
        }

    } catch (e: any) {
        console.error(`[Computer Control] ❌ Error:`, e);
        return `Error en control del ordenador (${action}): ${e.message}`;
    }
}

/**
 * ps-bridge.ts — Persistent PowerShell process for mouse/keyboard control.
 *
 * Instead of spawning a NEW powershell.exe for every action (~500-1000ms overhead),
 * this module keeps ONE long-running PowerShell process alive,
 * compiles the C# interop class ONCE at startup, and executes all subsequent
 * commands in ~5-15ms via stdin/stdout.
 *
 * This is the single biggest speed optimization for Orbit:
 *   Before: every click/type/move -> new PS process -> compile C# -> execute -> ~800ms
 *   After:  every click/type/move -> stdin write -> execute -> ~10ms
 */

import { spawn, ChildProcess } from "child_process";

const MARKER = "___ORBIT_DONE___";

let _proc: ChildProcess | null = null;
let _ready = false;
let _initResolve: (() => void) | null = null;
let _initReject: ((e: Error) => void) | null = null;
let _initPromise: Promise<void> | null = null;
let _buffer = "";
let _queue: Array<{
    resolve: (s: string) => void;
    reject: (e: Error) => void;
    timer: ReturnType<typeof setTimeout>;
}> = [];

// C# interop class + initialization (compiled ONCE)
const INIT_SCRIPT = `
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public struct POINT { public int X; public int Y; }
public class OrbitInput {
    [DllImport("user32.dll")] public static extern bool SetCursorPos(int X, int Y);
    [DllImport("user32.dll")] public static extern void mouse_event(uint f, uint x, uint y, uint d, UIntPtr e);
    [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
    [DllImport("shcore.dll")] public static extern int SetProcessDpiAwareness(int v);
    [DllImport("user32.dll")] public static extern bool GetCursorPos(out POINT p);
    public const uint LBDN=0x02, LBUP=0x04, RBDN=0x08, RBUP=0x10, WHEEL=0x0800;
    public static void Init(){ try{SetProcessDpiAwareness(2);}catch{SetProcessDPIAware();} }
    public static void Move(int x,int y){ SetCursorPos(x,y); }
    public static void LClick(){ mouse_event(LBDN,0,0,0,UIntPtr.Zero); System.Threading.Thread.Sleep(30); mouse_event(LBUP,0,0,0,UIntPtr.Zero); }
    public static void DblClick(){ LClick(); System.Threading.Thread.Sleep(80); LClick(); }
    public static void RClick(){ mouse_event(RBDN,0,0,0,UIntPtr.Zero); System.Threading.Thread.Sleep(30); mouse_event(RBUP,0,0,0,UIntPtr.Zero); }
    public static void Scroll(int a){ mouse_event(WHEEL,0,0,(uint)(a*120),UIntPtr.Zero); }
    public static void MouseDown(){ mouse_event(LBDN,0,0,0,UIntPtr.Zero); }
    public static void MouseUp(){ mouse_event(LBUP,0,0,0,UIntPtr.Zero); }
    public static string GetPos(){ POINT p; GetCursorPos(out p); return p.X+","+p.Y; }
}
"@ -ErrorAction SilentlyContinue
[OrbitInput]::Init()
Add-Type -AssemblyName System.Windows.Forms
Write-Output "${MARKER}"
`;

// Internal stdout handler
function _onData(chunk: Buffer) {
    _buffer += chunk.toString();

    let idx: number;
    while ((idx = _buffer.indexOf(MARKER)) !== -1) {
        const output = _buffer.substring(0, idx).trim();
        _buffer = _buffer.substring(idx + MARKER.length).replace(/^\r?\n/, "");

        if (!_ready) {
            _ready = true;
            console.log("[PS Bridge] Persistent PowerShell ready (C# compiled once)");
            if (_initResolve) {
                _initResolve();
                _initResolve = null;
                _initReject = null;
            }
        } else if (_queue.length > 0) {
            const q = _queue.shift()!;
            clearTimeout(q.timer);
            q.resolve(output);
        }
    }
}

// Start the persistent process
function _ensureProcess(): Promise<void> {
    if (_ready && _proc) return Promise.resolve();
    if (_initPromise) return _initPromise;

    _initPromise = new Promise<void>((resolve, reject) => {
        _initResolve = resolve;
        _initReject = reject;

        _proc = spawn("powershell.exe", [
            "-NoProfile", "-NoLogo", "-NonInteractive", "-Command", "-"
        ], {
            stdio: ["pipe", "pipe", "pipe"],
            windowsHide: true,
        });

        _buffer = "";
        _ready = false;

        _proc.stdout!.on("data", _onData);

        _proc.stderr!.on("data", (d: Buffer) => {
            const msg = d.toString().trim();
            if (msg && !msg.includes("SilentlyContinue") && !msg.includes("already exists")) {
                console.warn(`[PS Bridge] ${msg}`);
            }
        });

        _proc.on("exit", (code) => {
            console.log(`[PS Bridge] Process exited (code ${code})`);
            _ready = false;
            _proc = null;
            _initPromise = null;
            for (const q of _queue) {
                clearTimeout(q.timer);
                q.reject(new Error("PS process exited"));
            }
            _queue = [];
            if (_initReject) {
                _initReject(new Error("PS init process died"));
                _initReject = null;
                _initResolve = null;
            }
        });

        _proc.on("error", (err) => {
            console.error("[PS Bridge] Spawn error:", err.message);
            if (_initReject) {
                _initReject(err);
                _initReject = null;
                _initResolve = null;
            }
        });

        // Send init script
        _proc.stdin!.write(INIT_SCRIPT + "\n");

        // Timeout for init
        setTimeout(() => {
            if (!_ready) {
                const err = new Error("PS Bridge init timed out (15s)");
                if (_initReject) {
                    _initReject(err);
                    _initReject = null;
                    _initResolve = null;
                }
                killPS();
            }
        }, 15000);
    });

    return _initPromise;
}

// Public API

// ── Security: PowerShell script allowlist patterns ──────────────────────────
// Only scripts matching at least one pattern are allowed through runPS.
const PS_ALLOWED_PATTERNS: RegExp[] = [
    /^\[OrbitInput\]::/, // C# interop calls (Move, LClick, RClick, Scroll, GetPos, etc.)
    /^\[System\.Windows\.Forms\.SendKeys\]::SendWait\(/,  // Keystrokes
    /^Set-Clipboard\s/,             // Clipboard operations
    /^\$s\s*=\s*\[System\.Windows\.Forms\.Screen\]/, // Screen size query
    /^\$wshell\s*=\s*New-Object\s+-ComObject\s+WScript\.Shell/, // Window focus
    /^\(\[Text\.Encoding\]::Unicode/, // Base64-safe variable decode
];

function isAllowedScript(script: string): boolean {
    // A compound script may chain multiple allowed statements with '; '
    const statements = script.split(/;\s*/).map(s => s.trim()).filter(Boolean);
    return statements.every(stmt =>
        PS_ALLOWED_PATTERNS.some(p => p.test(stmt))
    );
}

/**
 * Execute a PowerShell script in the persistent process.
 * The C# OrbitInput class is already compiled — just call its methods.
 * Typical latency: ~5-15ms (vs ~500-1000ms when spawning new PS each time).
 *
 * Security: only scripts matching the allowlist patterns are executed.
 */
export async function runPS(script: string, timeout = 30000): Promise<string> {
    if (!isAllowedScript(script)) {
        throw new Error(`PS script bloqueado por seguridad: ${script.slice(0, 80)}...`);
    }
    await _ensureProcess();
    return new Promise<string>((resolve, reject) => {
        const timer = setTimeout(() => {
            const idx = _queue.findIndex(q => q.resolve === resolve);
            if (idx !== -1) _queue.splice(idx, 1);
            reject(new Error("PS command timed out"));
        }, timeout);
        _queue.push({ resolve, reject, timer });
        _proc!.stdin!.write(script + `\nWrite-Output "${MARKER}"\n`);
    });
}

/** Kill the persistent PS process (call on app shutdown). */
export function killPS() {
    if (_proc) {
        try { _proc.stdin!.end(); } catch {}
        try { _proc.kill(); } catch {}
        _proc = null;
        _ready = false;
        _initPromise = null;
    }
}

// Shared helpers (used by computer-control and screen-interaction)

/** Get cursor position via compiled C# (~5ms instead of ~500ms). */
export async function getCursorPos(): Promise<[number, number]> {
    const result = await runPS("[OrbitInput]::GetPos()", 5000);
    const parts = result.split(",").map(Number);
    return [parts[0] || 0, parts[1] || 0];
}

/** Get primary screen size (cached after first call). */
let _screenSizeCache: [number, number] | null = null;
export async function getScreenSize(): Promise<[number, number]> {
    if (_screenSizeCache) return _screenSizeCache;
    const result = await runPS(
        `$s = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds; Write-Output "$($s.Width),$($s.Height)"`,
        5000
    );
    const [w, h] = result.split(",").map(Number);
    _screenSizeCache = [w || 1920, h || 1080];
    return _screenSizeCache;
}

// Bezier mouse movement helpers

/** Gaussian jitter for human-like imprecision. */
export function jitter(px: number = 3): number {
    let u = 0, v = 0;
    while (u === 0) u = Math.random();
    while (v === 0) v = Math.random();
    return Math.floor(Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v) * px);
}

/** Quadratic Bezier + smoothstep easing, returns list of (x,y) points. */
export function bezierPoints(
    x0: number, y0: number,
    x1: number, y1: number,
    steps: number = 40
): Array<[number, number]> {
    const dx = x1 - x0, dy = y1 - y0;
    const mid_x = (x0 + x1) / 2 + (-dy * 0.28 + jitter(8));
    const mid_y = (y0 + y1) / 2 + (dx * 0.28 + jitter(8));
    const pts: Array<[number, number]> = [];
    for (let i = 0; i <= steps; i++) {
        const t_raw = i / steps;
        const t = t_raw * t_raw * (3 - 2 * t_raw);
        const px = Math.round((1 - t) * (1 - t) * x0 + 2 * (1 - t) * t * mid_x + t * t * x1);
        const py = Math.round((1 - t) * (1 - t) * y0 + 2 * (1 - t) * t * mid_y + t * t * y1);
        pts.push([px, py]);
    }
    return pts;
}

/**
 * Build a Bezier mouse-move PS script fragment.
 * Uses fewer steps for short distances (speed optimization).
 */
export function buildBezierScript(x0: number, y0: number, x1: number, y1: number): string {
    const dist = Math.hypot(x1 - x0, y1 - y0);
    const steps = Math.max(10, Math.min(30, Math.round(dist / 20)));
    const pts = bezierPoints(x0, y0, x1 + jitter(2), y1 + jitter(2), steps);
    const delay = Math.max(1, Math.round(200 / steps));
    let script = `$pts = @(${pts.map(([x, y]) => `@(${x},${y})`).join(",")});\n`;
    script += `foreach ($p in $pts) { [OrbitInput]::Move($p[0], $p[1]); Start-Sleep -Milliseconds ${delay}; }\n`;
    return script;
}

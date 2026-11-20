export const desktopWorker = String.raw`
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding
Add-Type -AssemblyName System.Windows.Forms
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
using System.Threading;

public static class OrbitInput {
    [StructLayout(LayoutKind.Sequential)]
    private struct Point { public int X; public int Y; }

    [DllImport("user32.dll")] private static extern bool SetCursorPos(int x, int y);
    [DllImport("user32.dll")] private static extern bool GetCursorPos(out Point point);
    [DllImport("user32.dll")] private static extern bool SetProcessDPIAware();
    [DllImport("shcore.dll")] private static extern int SetProcessDpiAwareness(int awareness);
    [DllImport("user32.dll")] private static extern void mouse_event(uint flags, uint x, uint y, uint data, UIntPtr extra);
    [DllImport("user32.dll")] private static extern void keybd_event(byte key, byte scan, uint flags, UIntPtr extra);

    public static void Init() {
        try { SetProcessDpiAwareness(2); }
        catch { SetProcessDPIAware(); }
    }

    public static int[] Position() {
        Point point;
        if (!GetCursorPos(out point)) throw new InvalidOperationException("No se pudo leer el cursor.");
        return new int[] { point.X, point.Y };
    }

    public static void Move(int[] coordinates, int delay) {
        for (int i = 0; i < coordinates.Length; i += 2) {
            if (!SetCursorPos(coordinates[i], coordinates[i + 1])) {
                throw new InvalidOperationException("No se pudo mover el cursor.");
            }
            if (i + 2 < coordinates.Length) Thread.Sleep(delay);
        }
    }

    private static void Button(uint flag) { mouse_event(flag, 0, 0, 0, UIntPtr.Zero); }

    public static void Click(bool right) {
        Button(right ? 8u : 2u);
        try { Thread.Sleep(25); }
        finally { Button(right ? 16u : 4u); }
    }

    public static void Drag(int[] coordinates, int delay) {
        Button(2);
        try { Move(coordinates, delay); }
        finally { Button(4); }
    }

    public static void Scroll(int amount, bool horizontal) {
        mouse_event(horizontal ? 0x1000u : 0x800u, 0, 0, unchecked((uint)(amount * 120)), UIntPtr.Zero);
    }

    public static void Keys(byte[] modifiers, byte key, bool extended) {
        foreach (byte modifier in modifiers) keybd_event(modifier, 0, modifier == 91 ? 1u : 0u, UIntPtr.Zero);
        uint flags = extended ? 1u : 0u;
        try {
            keybd_event(key, 0, flags, UIntPtr.Zero);
            keybd_event(key, 0, flags | 2u, UIntPtr.Zero);
        } finally {
            for (int i = modifiers.Length - 1; i >= 0; i--) {
                byte modifier = modifiers[i];
                keybd_event(modifier, 0, modifier == 91 ? 3u : 2u, UIntPtr.Zero);
            }
        }
    }
}
"@
[OrbitInput]::Init()
[Console]::WriteLine('{"ready":true}')

while ($null -ne ($line = [Console]::ReadLine())) {
    $request = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($line)) | ConvertFrom-Json
    $value = $null
    $failure = $null
    try {
        switch -Exact ($request.op) {
            'position' { $value = [OrbitInput]::Position() }
            'screen' {
                $bounds = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
                $value = @($bounds.Width, $bounds.Height)
            }
            'move' { [OrbitInput]::Move([int[]]$request.points, [int]$request.delay) }
            'click' { [OrbitInput]::Click($request.button -eq 'right') }
            'drag' { [OrbitInput]::Drag([int[]]$request.points, [int]$request.delay) }
            'scroll' { [OrbitInput]::Scroll([int]$request.amount, [bool]$request.horizontal) }
            'keys' { [OrbitInput]::Keys([byte[]]$request.modifiers, [byte]$request.key, [bool]$request.extended) }
            'type' {
                [System.Windows.Forms.Clipboard]::SetText([string]$request.text)
                [OrbitInput]::Keys([byte[]]@(17), 86, $false)
            }
            'focus' {
                $shell = New-Object -ComObject WScript.Shell
                if (!$shell.AppActivate([string]$request.title)) { throw 'No se pudo activar la ventana.' }
            }
            default { throw 'Operación de escritorio desconocida.' }
        }
    } catch {
        $failure = $_.Exception.Message
    }
    $reply = @{ id = $request.id; value = $value; error = $failure }
    [Console]::WriteLine(($reply | ConvertTo-Json -Compress -Depth 3))
}
`;

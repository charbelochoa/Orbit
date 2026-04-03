"use strict";

const { app, BrowserWindow, Tray, Menu, shell, nativeImage, ipcMain, screen, globalShortcut, clipboard } = require("electron");
const { spawn, execSync } = require("child_process");
const path = require("path");
const net = require("net");
const fs = require("fs");

const ROOT = path.join(__dirname, "..");
const ICON_PATH = path.join(ROOT, "assets", "icon.png");
const IS_PACKED = app.isPackaged;
const OVERLAY_HTML = path.join(ROOT, "src", "ui", "overlay", "overlay.html");
const OVERLAY_PRELOAD = path.join(__dirname, "overlay-preload.cjs");

let mainWindow = null;
let overlayWindow = null;
let tray = null;
let backend = null;
let isQuitting = false;
let backendReady = false;
let gatewayWs = null;
let contextPanelVisible = false;
let sessionToken = "";

function log(msg)  { console.log(`[Electron] ${msg}`); }
function warn(msg) { console.warn(`[Electron] ${msg}`); }
function err(msg)  { console.error(`[Electron] ${msg}`); }

function waitForPort(port, maxAttempts = 60, intervalMs = 500) {
  return new Promise((resolve, reject) => {
    let attempts = 0;
    const tryConnect = () => {
      const socket = new net.Socket();
      socket.setTimeout(400);
      socket.on("connect", () => { socket.destroy(); resolve(); });
      socket.on("error", () => {
        socket.destroy();
        if (++attempts >= maxAttempts) reject(new Error(`Puerto ${port} no respondio`));
        else setTimeout(tryConnect, intervalMs);
      });
      socket.on("timeout", () => {
        socket.destroy();
        if (++attempts >= maxAttempts) reject(new Error(`Puerto ${port} timeout`));
        else setTimeout(tryConnect, intervalMs);
      });
      socket.connect(port, "127.0.0.1");
    };
    tryConnect();
  });
}

function isPortInUse(port) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    socket.setTimeout(500);
    socket.on("connect",  () => { socket.destroy(); resolve(true);  });
    socket.on("error",    () => { socket.destroy(); resolve(false); });
    socket.on("timeout",  () => { socket.destroy(); resolve(false); });
    socket.connect(port, "127.0.0.1");
  });
}

async function startBackend() {
  if (await isPortInUse(3000)) {
    log("Backend ya esta corriendo en puerto 3000. Saltando spawn.");
    backendReady = true;
    return;
  }
  log("Iniciando backend...");
  let cmd, args;
  if (IS_PACKED) {
    cmd = process.execPath;
    args = [path.join(process.resourcesPath, "app", "dist", "index.js")];
  } else {
    const npx = process.platform === "win32" ? "npx.cmd" : "npx";
    cmd = npx;
    args = ["tsx", "src/index.ts"];
  }
  backend = spawn(cmd, args, {
    cwd: ROOT,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
    stdio: ["ignore", "pipe", "pipe"],
    detached: false,
  });
  backend.stdout.on("data", (data) => {
    const line = data.toString().trim();
    if (line) process.stdout.write(`[Backend] ${line}\n`);
    // Capture session token from gateway output
    const tokenMatch = line.match(/\[Gateway\] Session token: ([a-f0-9]+)/);
    if (tokenMatch) sessionToken = tokenMatch[1];
    if (line.includes("Orbit esta en linea") || line.includes("Sesion lista")) {
      backendReady = true;
    }
  });
  backend.stderr.on("data", (data) => {
    const line = data.toString().trim();
    if (line) process.stderr.write(`[Backend] ${line}\n`);
  });
  backend.on("exit", (code, signal) => {
    log(`Backend termino (codigo ${code}, senal ${signal})`);
    backend = null;
    backendReady = false;
    if (!isQuitting) {
      warn("Backend caido - reintentando en 3s...");
      setTimeout(startBackend, 3000);
    }
  });
  backend.on("error", (e) => {
    err(`No se pudo iniciar backend: ${e.message}`);
  });
}

function createTray() {
  let icon;
  if (fs.existsSync(ICON_PATH)) {
    icon = nativeImage.createFromPath(ICON_PATH).resize({ width: 16, height: 16 });
  } else {
    const FB = "iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAACXBIWXMAAAsTAAALEwEAmpwYAAAAZ0lEQVQ4y2NgGAWDB/z//5+BEsxANWZGqgFjDRiNBow1YDQaYKQbYNgAo90Aow0w2g0w0gAj3QCjDTDaDTDSAKPdAKMNMNoNMNIAI90Aow0w2g0w0gAj3QCjDTDaDTDaAIPdAAMGAACMGQXZiXqMIgAAAABJRU5ErkJggg==";
    icon = nativeImage.createFromDataURL(`data:image/png;base64,${FB}`);
  }
  tray = new Tray(icon);
  const buildMenu = () => Menu.buildFromTemplate([
    { label: "Orbit AI", enabled: false },
    { type: "separator" },
    { label: "Mostrar Orbit",      click: () => { if (mainWindow) { mainWindow.show(); mainWindow.focus(); } } },
    { label: "Abrir en navegador", click: () => shell.openExternal("http://localhost:3000") },
    { type: "separator" },
    { label: "Salir", click: () => { isQuitting = true; app.quit(); } },
  ]);
  tray.setContextMenu(buildMenu());
  tray.setToolTip("Orbit AI");
  tray.setTitle("Orbit");
  tray.on("double-click", () => {
    if (mainWindow) {
      mainWindow.isVisible() ? mainWindow.focus() : mainWindow.show();
    }
  });
  log("System tray creado");
}

function sendToOverlay(channel, data) {
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    overlayWindow.webContents.send(channel, data);
  }
}

function createOverlay() {
  if (!fs.existsSync(OVERLAY_HTML)) {
    warn("overlay.html no encontrado, saltando overlay");
    return;
  }
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;
  overlayWindow = new BrowserWindow({
    x: 0, y: 0, width, height,
    frame: false, transparent: true, alwaysOnTop: true,
    skipTaskbar: true, resizable: false, movable: false,
    minimizable: false, maximizable: false, focusable: true,
    hasShadow: false, show: false,
    webPreferences: {
      preload: fs.existsSync(OVERLAY_PRELOAD) ? OVERLAY_PRELOAD : undefined,
      contextIsolation: true, nodeIntegration: false, webSecurity: true,
    },
  });
  overlayWindow.setIgnoreMouseEvents(true, { forward: true });
  overlayWindow.setAlwaysOnTop(true, "screen-saver");
  overlayWindow.setMenu(null);
  overlayWindow.loadFile(OVERLAY_HTML);
  overlayWindow.once("ready-to-show", () => {
    overlayWindow.showInactive();
    log("Overlay listo");
    sendToOverlay("orb_connected", true);
  });
  overlayWindow.on("closed", () => { overlayWindow = null; });
  screen.on("display-metrics-changed", () => {
    if (overlayWindow && !overlayWindow.isDestroyed()) {
      const { width: w, height: h } = screen.getPrimaryDisplay().workAreaSize;
      overlayWindow.setBounds({ x: 0, y: 0, width: w, height: h });
    }
  });
  log("Overlay window creado");
}

ipcMain.on("overlay_click_through", (_, enabled) => {
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    overlayWindow.setIgnoreMouseEvents(enabled, enabled ? { forward: true } : undefined);
  }
});
ipcMain.on("overlay_request_focus", () => {
  if (overlayWindow && !overlayWindow.isDestroyed()) overlayWindow.setIgnoreMouseEvents(false);
});
ipcMain.on("window:hide", () => {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.hide();
});
ipcMain.on("overlay_toggle_chat", () => {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.isVisible() ? mainWindow.hide() : (mainWindow.show(), mainWindow.focus());
});
ipcMain.on("overlay_move_to", (_, data) => { sendToOverlay("overlay_move_to", data); });

async function createWindow() {
  log("Creando ventana principal...");
  const PRELOAD = path.join(__dirname, "preload.cjs");
  mainWindow = new BrowserWindow({
    width: 420, height: 720, minWidth: 360, minHeight: 560, maxWidth: 500,
    title: "Orbit AI", show: false, backgroundColor: "#09090b",
    frame: false, titleBarStyle: "hidden", transparent: false, resizable: true,
    webPreferences: {
      preload: fs.existsSync(PRELOAD) ? PRELOAD : undefined,
      contextIsolation: true, nodeIntegration: false, webSecurity: true,
    },
    ...(fs.existsSync(ICON_PATH) ? { icon: ICON_PATH } : {}),
  });
  await mainWindow.loadURL("http://localhost:3000");
  mainWindow.once("ready-to-show", () => log("Ventana lista"));
  mainWindow.on("close", (e) => {
    if (!isQuitting) {
      e.preventDefault();
      mainWindow.hide();
      if (tray && !app._trayNotified) {
        tray.displayBalloon?.({ title: "Orbit sigue activo", content: "Corre en segundo plano.", iconType: "info" });
        app._trayNotified = true;
      }
    }
  });
  mainWindow.on("closed", () => { mainWindow = null; });
  if (!IS_PACKED) {
    mainWindow.webContents.on("before-input-event", (_e, input) => {
      if (input.key === "F12" && input.type === "keyDown") mainWindow.webContents.toggleDevTools();
    });
  }
}

function connectGatewayBridge() {
  let WS;
  try { WS = require("ws"); } catch (_) { return; }
  function tryConnect() {
    if (isQuitting) return;
    const wsUrl = sessionToken ? `ws://localhost:18789?token=${sessionToken}` : "ws://localhost:18789";
    try { gatewayWs = new WS.WebSocket(wsUrl); }
    catch (_) { setTimeout(tryConnect, 5000); return; }
    gatewayWs.on("open", () => {
      log("Gateway bridge conectado");
      sendToOverlay("orb_connected", true);
      // Notificar al backend que Electron está conectado (habilita toasts nativos)
      gatewayWs.send(JSON.stringify({ type: "electron_connected", value: true }));
    });
    gatewayWs.on("message", (raw) => {
      let msg;
      try { msg = JSON.parse(raw.toString()); } catch (_) { return; }
      switch (msg.type) {
        case "orbit_ready":   sendToOverlay("orb_state", { state: "idle" }); break;
        case "orbit_message":
          sendToOverlay("orb_speak", { text: msg.text, duration: 5000 });
          sendToOverlay("orb_state", { state: "speaking" });
          setTimeout(() => sendToOverlay("orb_state", { state: "idle" }), 2000);
          break;
        case "orbit_chunk":   sendToOverlay("orb_state", { state: "speaking" }); break;
        case "turn_complete": sendToOverlay("orb_state", { state: "idle" }); break;
        case "tool_call":     sendToOverlay("orb_state", { state: "thinking" }); break;
        case "typing":
          sendToOverlay("orb_state", { state: (msg.state === "thinking" || msg.state === "executing") ? "thinking" : "idle" });
          break;
        case "error":       sendToOverlay("orb_state", { state: "error" }); break;
        case "task_update":
          if (msg.status === "done") {
            sendToOverlay("orb_state", { state: "happy" });
            setTimeout(() => sendToOverlay("orb_state", { state: "idle" }), 3000);
          }
          break;
        case "user_message": sendToOverlay("orb_state", { state: "thinking" }); break;

        // ── Sprint 12: Toast Notifications ────────────────────────────────
        case "notify_toast": {
          const { Notification } = require("electron");
          if (Notification.isSupported()) {
            const n = new Notification({
              title:  msg.title  || "Orbit",
              body:   msg.body   || "",
              silent: msg.silent || false,
              // urgency reuse tag for grouping (Linux/Win10+)
              ...(msg.sourceId ? { tag: msg.sourceId } : {}),
            });
            n.show();
          } else {
            // Fallback: tray balloon (Windows 7 / unsupported)
            tray?.displayBalloon?.({ title: msg.title || "Orbit", content: msg.body || "", iconType: "info" });
          }
          break;
        }

        // ── Sprint 12: Wake Word detected ─────────────────────────────────
        case "wake_word_detected": {
          log(`Wake word: "${msg.phrase}"`);
          // Mostrar overlay y enfocar la ventana principal
          if (overlayWindow && !overlayWindow.isDestroyed()) {
            overlayWindow.setIgnoreMouseEvents(false);
          }
          if (mainWindow && !mainWindow.isDestroyed()) {
            if (!mainWindow.isVisible()) mainWindow.show();
            mainWindow.focus();
          }
          sendToOverlay("orb_state", { state: "thinking" });
          break;
        }
      }
    });
    gatewayWs.on("close", () => {
      log("Gateway bridge desconectado - reintentando...");
      sendToOverlay("orb_connected", false);
      gatewayWs = null;
      if (!isQuitting) setTimeout(tryConnect, 5000);
    });
    gatewayWs.on("error", () => {});
  }
  setTimeout(tryConnect, 3000);
}

app.whenReady().then(async () => {
  log(`Orbit AI iniciando... (empaquetado: ${IS_PACKED})`);
  startBackend();
  log("Esperando backend en puerto 3000...");
  try {
    await waitForPort(3000, 60, 500);
    log("Backend listo en puerto 3000");
  } catch (e) {
    err(`Backend no respondio: ${e.message}`);
    err("Verifica que GEMINI_API_KEY este configurada en .env");
  }
  createTray();
  createOverlay();
  await createWindow();
  connectGatewayBridge();
  registerGlobalHotkeys();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
  else if (mainWindow) mainWindow.show();
});

app.on("window-all-closed", (e) => {
  if (process.platform !== "darwin" && !isQuitting) e.preventDefault();
});

app.on("before-quit", () => {
  log("Cerrando Orbit...");
  isQuitting = true;
  globalShortcut.unregisterAll();
  if (gatewayWs) { try { gatewayWs.close(); } catch (_) {} gatewayWs = null; }
  if (backend) {
    backend.kill("SIGTERM");
    setTimeout(() => { if (backend) backend.kill("SIGKILL"); }, 2000);
  }
});

app.on("quit", () => log("Orbit cerrado."));

// ── Phase 8.1: Global Hotkey + Context Detection ─────────────────────────────

/**
 * Detect which app is focused and if there's selected text.
 * Uses PowerShell + Windows API for context awareness.
 */
function detectContext() {
  const result = { app: "", title: "", selectedText: "" };
  try {
    // Get foreground window info
    const psScript = `
      Add-Type @"
      using System;
      using System.Runtime.InteropServices;
      using System.Text;
      public class FGWin {
        [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
        [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
        [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
      }
"@
      $h = [FGWin]::GetForegroundWindow()
      $sb = New-Object System.Text.StringBuilder 256
      [FGWin]::GetWindowText($h, $sb, 256) | Out-Null
      $pid = 0
      [FGWin]::GetWindowThreadProcessId($h, [ref]$pid) | Out-Null
      $proc = Get-Process -Id $pid -ErrorAction SilentlyContinue
      $name = if ($proc) { $proc.ProcessName } else { "unknown" }
      Write-Output "$name|||$($sb.ToString())"
    `;
    const out = execSync(`powershell -NoProfile -Command "${psScript.replace(/"/g, '\\"').replace(/\n/g, ' ')}"`, {
      timeout: 3000, windowsHide: true, encoding: "utf-8"
    }).trim();
    const [appName, title] = out.split("|||");
    result.app = appName || "";
    result.title = title || "";
  } catch (_) {}

  // Try to get clipboard text (may contain selection if Ctrl+C was pressed)
  try {
    result.selectedText = clipboard.readText().slice(0, 2000);
  } catch (_) {}

  return result;
}

function registerGlobalHotkeys() {
  // Ctrl+Shift+O → toggle ventana principal de Orbit
  const registeredMain = globalShortcut.register("Ctrl+Shift+O", () => {
    log("Ctrl+Shift+O presionado — toggle ventana principal");
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isVisible() && mainWindow.isFocused()) {
        mainWindow.hide();
      } else {
        mainWindow.show();
        mainWindow.focus();
      }
    }
  });
  if (registeredMain) log("Hotkey Ctrl+Shift+O registrado (toggle ventana)");
  else warn("No se pudo registrar Ctrl+Shift+O");

  // Alt+Space → toggle panel de contexto del overlay
  const registered = globalShortcut.register("Alt+Space", () => {
    log("Alt+Space presionado");
    contextPanelVisible = !contextPanelVisible;

    if (contextPanelVisible) {
      const ctx = detectContext();
      log(`Contexto: app=${ctx.app}, titulo=${ctx.title.slice(0, 40)}, texto=${ctx.selectedText.length} chars`);

      // Send context to overlay
      sendToOverlay("orb_context", {
        visible: true,
        app: ctx.app,
        title: ctx.title,
        hasText: ctx.selectedText.length > 0,
        textPreview: ctx.selectedText.slice(0, 100),
      });

      // Also send to gateway for the agent to use
      if (gatewayWs && gatewayWs.readyState === 1) {
        gatewayWs.send(JSON.stringify({
          type: "context_detected",
          app: ctx.app,
          title: ctx.title,
          selectedText: ctx.selectedText,
        }));
      }

      // Show overlay interaction
      if (overlayWindow && !overlayWindow.isDestroyed()) {
        overlayWindow.setIgnoreMouseEvents(false);
      }
    } else {
      sendToOverlay("orb_context", { visible: false });
      if (overlayWindow && !overlayWindow.isDestroyed()) {
        overlayWindow.setIgnoreMouseEvents(true, { forward: true });
      }
    }
  });

  if (registered) {
    log("Hotkey global Alt+Space registrado");
  } else {
    warn("No se pudo registrar Alt+Space (¿ya en uso?)");
  }
}

// Handle contextual actions from overlay
ipcMain.on("overlay_context_action", (_, data) => {
  const { action, selectedText } = data;
  log(`Accion contextual: ${action}`);
  contextPanelVisible = false;
  sendToOverlay("orb_context", { visible: false });
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    overlayWindow.setIgnoreMouseEvents(true, { forward: true });
  }

  // Send the action as a chat message through the gateway
  if (gatewayWs && gatewayWs.readyState === 1) {
    let prompt = "";
    switch (action) {
      case "explain":
        prompt = `Explica este texto/código:\n\n${selectedText}`;
        break;
      case "refactor":
        prompt = `Refactoriza este código:\n\n${selectedText}`;
        break;
      case "bugs":
        prompt = `Busca bugs y problemas en este código:\n\n${selectedText}`;
        break;
      case "improve":
        prompt = `Mejora este código/texto:\n\n${selectedText}`;
        break;
      default:
        prompt = `${action}: ${selectedText}`;
    }
    gatewayWs.send(JSON.stringify({ type: "chat", payload: { text: prompt } }));
  }

  // Show main window with the result
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.show();
    mainWindow.focus();
  }
});

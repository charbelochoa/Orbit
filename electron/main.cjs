"use strict";

/**
 * Orbit AI — Electron Main Process
 * ─────────────────────────────────────────────────────────────────────────────
 * Arquitectura:
 *  1. Inicia el backend Node.js (src/index.ts via tsx) como proceso hijo
 *  2. Espera que el puerto 3000 esté activo
 *  3. Abre la BrowserWindow cargando http://localhost:3000
 *  4. Crea system tray con opciones básicas
 *  5. Al cerrar la ventana → ocultar al tray (no salir)
 *  6. Al salir → mata el backend limpiamente
 */

const { app, BrowserWindow, Tray, Menu, shell, nativeImage, ipcMain, screen } = require("electron");
const { spawn } = require("child_process");
const path    = require("path");
const net     = require("net");
const fs      = require("fs");

// ─── Paths ────────────────────────────────────────────────────────────────────
const ROOT       = path.join(__dirname, "..");
const ICON_PATH  = path.join(ROOT, "assets", "icon.png");
const IS_PACKED  = app.isPackaged;

// ─── Paths ────────────────────────────────────────────────────────────────────
const OVERLAY_HTML    = path.join(ROOT, "src", "ui", "overlay", "overlay.html");
const OVERLAY_PRELOAD = path.join(__dirname, "overlay-preload.cjs");

// ─── State ────────────────────────────────────────────────────────────────────
let mainWindow   = null;
let overlayWindow = null;
let tray         = null;
let backend      = null;
let isQuitting   = false;
let backendReady = false;

// ─── Logging ─────────────────────────────────────────────────────────────────
function log(msg)  { console.log(`[Electron] ${msg}`); }
function warn(msg) { console.warn(`[Electron] ⚠️  ${msg}`); }
function err(msg)  { console.error(`[Electron] ❌ ${msg}`); }

// ─── Wait for TCP port ────────────────────────────────────────────────────────
function waitForPort(port, maxAttempts = 60, intervalMs = 500) {
    return new Promise((resolve, reject) => {
        let attempts = 0;

        const tryConnect = () => {
            const socket = new net.Socket();

            socket.setTimeout(400);
            socket.on("connect", () => {
                socket.destroy();
                resolve();
            });
            socket.on("error", () => {
                socket.destroy();
                if (++attempts >= maxAttempts) {
                    reject(new Error(`Puerto ${port} no respondió tras ${maxAttempts} intentos`));
                } else {
                    setTimeout(tryConnect, intervalMs);
                }
            });
            socket.on("timeout", () => {
                socket.destroy();
                if (++attempts >= maxAttempts) {
                    reject(new Error(`Puerto ${port} timeout tras ${maxAttempts} intentos`));
                } else {
                    setTimeout(tryConnect, intervalMs);
                }
            });
            socket.connect(port, "127.0.0.1");
        };

        tryConnect();
    });
}

// ─── Start Backend ────────────────────────────────────────────────────────────
function startBackend() {
    log("🚀 Iniciando backend...");

    let cmd, args;

    if (IS_PACKED) {
        // Producción: usar Node.js empaquetado con el código compilado
        cmd  = process.execPath; // el Node.js que viene con Electron
        args = [path.join(process.resourcesPath, "app", "dist", "index.js")];
    } else {
        // Desarrollo: tsx watch para hot-reload
        const npx = process.platform === "win32" ? "npx.cmd" : "npx";
        cmd  = npx;
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

        // Detectar cuando el backend está listo
        if (line.includes("Orbit está en línea") || line.includes("Sesión lista")) {
            backendReady = true;
        }
    });

    backend.stderr.on("data", (data) => {
        const line = data.toString().trim();
        if (line) process.stderr.write(`[Backend] ${line}\n`);
    });

    backend.on("exit", (code, signal) => {
        log(`Backend terminó (código ${code}, señal ${signal})`);
        backend = null;
        backendReady = false;

        // Reiniciar si Electron sigue corriendo y no se pidió salir
        if (!isQuitting) {
            warn("Backend caído — reintentando en 3s...");
            setTimeout(startBackend, 3000);
        }
    });

    backend.on("error", (e) => {
        err(`No se pudo iniciar backend: ${e.message}`);
    });
}

// ─── Create Tray ─────────────────────────────────────────────────────────────
function createTray() {
    let icon;
    if (fs.existsSync(ICON_PATH)) {
        icon = nativeImage.createFromPath(ICON_PATH).resize({ width: 16, height: 16 });
    } else {
        // Icono inline 16×16 (círculo morado mínimo en base64 PNG)
        const FALLBACK_ICON = "iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAACXBIWXMAAAsTAAALEwEAmpwYAAAAZ0lEQVQ4y2NgGAWDB/z//5+BEsxANWZGqgFjDRiNBow1YDQaYKQbYNgAo90Aow0w2g0w0gAj3QCjDTDaDTDSAKPdAKMNMNoNMNIAI90Aow0w2g0w0gAj3QCjDTDaDTDaAIPdAAMGAACMGQXZiXqMIgAAAABJRU5ErkJggg==";
        icon = nativeImage.createFromDataURL(`data:image/png;base64,${FALLBACK_ICON}`);
    }

    tray = new Tray(icon);

    const updateMenu = () => Menu.buildFromTemplate([
        {
            label: "🛸 Orbit AI",
            enabled: false,
        },
        { type: "separator" },
        {
            label: "Mostrar Orbit",
            click: () => { if (mainWindow) { mainWindow.show(); mainWindow.focus(); } }
        },
        {
            label: "Abrir en navegador",
            click: () => shell.openExternal("http://localhost:3000")
        },
        { type: "separator" },
        {
            label: "Salir",
            click: () => {
                isQuitting = true;
                app.quit();
            }
        },
    ]);

    tray.setContextMenu(updateMenu());
    tray.setToolTip("Orbit AI — Asistente local");
    tray.setTitle("Orbit");

    tray.on("double-click", () => {
        if (mainWindow) {
            if (mainWindow.isVisible()) {
                mainWindow.focus();
            } else {
                mainWindow.show();
                mainWindow.focus();
            }
        }
    });

    log("🔵 System tray creado");
}

// ─── Send to Overlay ─────────────────────────────────────────────────────────
function sendToOverlay(channel, data) {
    if (overlayWindow && !overlayWindow.isDestroyed()) {
        overlayWindow.webContents.send(channel, data);
    }
}

// ─── Create Overlay Window ───────────────────────────────────────────────────
function createOverlay() {
    if (!fs.existsSync(OVERLAY_HTML)) {
        warn("overlay.html no encontrado, saltando overlay");
        return;
    }

    const { width, height } = screen.getPrimaryDisplay().workAreaSize;

    overlayWindow = new BrowserWindow({
        x: 0, y: 0,
        width, height,
        frame:       false,
        transparent: true,
        alwaysOnTop: true,
        skipTaskbar: true,
        resizable:   false,
        movable:     false,
        minimizable: false,
        maximizable: false,
        focusable:   false,     // No robar foco de otras apps
        hasShadow:   false,
        show:        false,
        webPreferences: {
            preload:          fs.existsSync(OVERLAY_PRELOAD) ? OVERLAY_PRELOAD : undefined,
            contextIsolation: true,
            nodeIntegration:  false,
            webSecurity:      true,
        },
    });

    // Click-through por defecto (clics pasan a apps de abajo)
    overlayWindow.setIgnoreMouseEvents(true, { forward: true });

    // Always on top al nivel de screen-saver
    overlayWindow.setAlwaysOnTop(true, "screen-saver");

    overlayWindow.setMenu(null);
    overlayWindow.loadFile(OVERLAY_HTML);

    overlayWindow.once("ready-to-show", () => {
        overlayWindow.showInactive(); // Mostrar sin robar foco
        log("🎮 Overlay del orbe listo");
        sendToOverlay("orb_connected", true);
    });

    overlayWindow.on("closed", () => { overlayWindow = null; });

    // Adaptar al cambiar resolución
    screen.on("display-metrics-changed", () => {
        if (overlayWindow && !overlayWindow.isDestroyed()) {
            const { width: w, height: h } = screen.getPrimaryDisplay().workAreaSize;
            overlayWindow.setBounds({ x: 0, y: 0, width: w, height: h });
        }
    });

    log("🎮 Overlay window creado");
}

// ─── IPC Handlers (Overlay) ───────────────────────────────────────────────────
ipcMain.on("overlay_click_through", (_, enabled) => {
    if (overlayWindow && !overlayWindow.isDestroyed()) {
        if (enabled) {
            overlayWindow.setIgnoreMouseEvents(true, { forward: true });
        } else {
            overlayWindow.setIgnoreMouseEvents(false);
        }
    }
});

ipcMain.on("overlay_toggle_chat", () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (mainWindow.isVisible()) {
        mainWindow.hide();
    } else {
        mainWindow.show();
        mainWindow.focus();
    }
});

ipcMain.on("overlay_move_to", (_, data) => {
    sendToOverlay("overlay_move_to", data);
});

// ─── Create Main Window ───────────────────────────────────────────────────────
async function createWindow() {
    log("🖥️  Creando ventana principal...");

    const PRELOAD = path.join(__dirname, "preload.cjs");

    mainWindow = new BrowserWindow({
        width:     1280,
        height:    800,
        minWidth:  960,
        minHeight: 600,
        title:     "Orbit AI",
        show:      false,  // se muestra después de cargar
        backgroundColor: "#0a0b0f",

        webPreferences: {
            preload:          fs.existsSync(PRELOAD) ? PRELOAD : undefined,
            contextIsolation: true,
            nodeIntegration:  false,
            webSecurity:      true,
        },

        // Icono de la ventana (Windows taskbar)
        ...(fs.existsSync(ICON_PATH) ? { icon: ICON_PATH } : {}),
    });

    // Cargar la Web UI
    await mainWindow.loadURL("http://localhost:3000");

    // Mostrar solo cuando cargó (sin flash blanco)
    mainWindow.once("ready-to-show", () => {
        mainWindow.show();
        log("✅ Ventana lista");
    });

    // Ocultar al tray en vez de cerrar
    mainWindow.on("close", (e) => {
        if (!isQuitting) {
            e.preventDefault();
            mainWindow.hide();
            // Notificación solo la primera vez
            if (tray && !app._trayNotified) {
                tray.displayBalloon?.({
                    title:   "Orbit sigue activo",
                    content: "Orbit corre en segundo plano. Doble click en el tray para volver.",
                    iconType: "info",
                });
                app._trayNotified = true;
            }
        }
    });

    mainWindow.on("closed", () => { mainWindow = null; });

    // DevTools en desarrollo
    if (!IS_PACKED) {
        mainWindow.webContents.on("before-input-event", (_e, input) => {
            if (input.key === "F12" && input.type === "keyDown") {
                mainWindow.webContents.toggleDevTools();
            }
        });
    }
}

// ─── Gateway Bridge (forwards events to overlay) ─────────────────────────────
// Lightweight WS client that reads Orbit gateway and pushes orb state to overlay
let gatewayWs = null;

function connectGatewayBridge() {
    // Only available if 'ws' is installed — use dynamic require
    let WS;
    try { WS = require("ws"); } catch (_) { return; } // ws not available, skip

    function tryConnect() {
        if (isQuitting) return;
        try {
            gatewayWs = new WS.WebSocket("ws://localhost:18789");
        } catch (_) {
            setTimeout(tryConnect, 5000);
            return;
        }

        gatewayWs.on("open", () => {
            log("🌐 Gateway bridge conectado");
            sendToOverlay("orb_connected", true);
        });

        gatewayWs.on("message", (raw) => {
            let msg;
            try { msg = JSON.parse(raw.toString()); } catch (_) { return; }

            // Map gateway messages → orb states
            switch (msg.type) {
                case "orbit_ready":
                    sendToOverlay("orb_state", { state: "idle" });
                    break;
                case "orbit_message":
                    sendToOverlay("orb_speak", { text: msg.text, duration: 5000 });
                    sendToOverlay("orb_state", { state: "speaking" });
                    setTimeout(() => sendToOverlay("orb_state", { state: "idle" }), 2000);
                    break;
                case "orbit_chunk":
                    sendToOverlay("orb_state", { state: "speaking" });
                    break;
                case "turn_complete":
                    sendToOverlay("orb_state", { state: "idle" });
                    break;
                case "tool_call":
                    sendToOverlay("orb_state", { state: "thinking" });
                    break;
                case "typing":
                    if (msg.state === "thinking" || msg.state === "executing") {
                        sendToOverlay("orb_state", { state: "thinking" });
                    } else {
                        sendToOverlay("orb_state", { state: "idle" });
                    }
                    break;
                case "error":
                    sendToOverlay("orb_state", { state: "error" });
                    break;
                case "task_update":
                    // Task completed with success
                    if (msg.status === "done") {
                        sendToOverlay("orb_state", { state: "happy" });
                        setTimeout(() => sendToOverlay("orb_state", { state: "idle" }), 3000);
                    }
                    break;
                case "user_message":
                    sendToOverlay("orb_state", { state: "thinking" });
                    break;
            }
        });

        gatewayWs.on("close", () => {
            log("Gateway bridge desconectado — reintentando en 5s...");
            sendToOverlay("orb_connected", false);
            gatewayWs = null;
            if (!isQuitting) setTimeout(tryConnect, 5000);
        });

        gatewayWs.on("error", () => {
            // Will trigger close
        });
    }

    // Wait for backend to be ready before connecting
    setTimeout(tryConnect, 3000);
}

// ─── App Lifecycle ────────────────────────────────────────────────────────────
app.whenReady().then(async () => {
    log(`🛸 Orbit AI iniciando... (empaquetado: ${IS_PACKED})`);

    // 1. Arrancar backend
    startBackend();

    // 2. Esperar a que el puerto 3000 esté disponible (max 30 seg)
    log("⏳ Esperando backend en puerto 3000...");
    try {
        await waitForPort(3000, 60, 500);
        log("✅ Backend listo en puerto 3000");
    } catch (e) {
        err(`Backend no respondió: ${e.message}`);
        err("Verifica que GEMINI_API_KEY esté configurada en .env");
        // Mostrar ventana igual (mostrará error de conexión desde la UI)
    }

    // 3. System tray
    createTray();

    // 4. Overlay del orbe (pixel art mascot)
    createOverlay();

    // 5. Ventana principal
    await createWindow();

    // 6. Gateway bridge para el overlay
    connectGatewayBridge();
});

// macOS: re-crear ventana si se hace click en el dock
app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
    } else if (mainWindow) {
        mainWindow.show();
    }
});

// Impedir que la app se cierre si no hay ventanas (corremos en tray)
app.on("window-all-closed", (e) => {
    if (process.platform !== "darwin" && !isQuitting) {
        e.preventDefault();
    }
});

// Limpieza al salir
app.on("before-quit", () => {
    log("👋 Cerrando Orbit...");
    isQuitting = true;
    if (gatewayWs) { try { gatewayWs.close(); } catch (_) {} gatewayWs = null; }
    if (backend) {
        backend.kill("SIGTERM");
        // Forzar en 2 segundos si no terminó
        setTimeout(() => {
            if (backend) backend.kill("SIGKILL");
        }, 2000);
    }
});

app.on("quit", () => {
    log("Orbit cerrado.");
});

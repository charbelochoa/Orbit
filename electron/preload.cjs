"use strict";

/**
 * Orbit AI — Electron Preload Script
 * ─────────────────────────────────────────────────────────────────────────────
 * Corre en el contexto del renderer con acceso limitado a Electron APIs.
 * Expone solo lo estrictamente necesario al frontend vía contextBridge.
 */

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("orbitElectron", {
    // Versión de la app
    version: process.env.npm_package_version || "1.0.0",

    // ¿Está corriendo dentro de Electron?
    isElectron: true,

    // Plataforma del SO
    platform: process.platform,
    openProviderSettings: () => ipcRenderer.invoke("orbit:open-config"),
    selectWorkspace: current => ipcRenderer.invoke("orbit:select-workspace", current),
    getProviderSettings: () => ipcRenderer.invoke("orbit:provider-settings"),
    saveProvider: settings => ipcRenderer.invoke("orbit:save-provider", settings),

    // Enviar evento al main process
    send: (channel, data) => {
        const ALLOWED_CHANNELS = ["app:minimize", "app:close", "app:quit", "window:hide"];
        if (ALLOWED_CHANNELS.includes(channel)) {
            ipcRenderer.send(channel, data);
        }
    },

    // Recibir eventos del main process
    on: (channel, callback) => {
        const ALLOWED_CHANNELS = ["backend:ready", "backend:error", "orbit:tray-click"];
        if (ALLOWED_CHANNELS.includes(channel)) {
            ipcRenderer.on(channel, (_event, ...args) => callback(...args));
        }
    },
});

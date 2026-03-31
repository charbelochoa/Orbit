"use strict";

/**
 * Orbit AI — Overlay Preload Script
 * ─────────────────────────────────────────────────────────────────────────────
 * Context bridge para el overlay del pixel art orb.
 * Expone solo lo necesario para controlar el orbe desde el main process.
 */

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("orbitOverlay", {
  // ── Recibir eventos del main process ──────────────────────────────
  onOrbState:    (cb) => ipcRenderer.on("orb_state",        (_, d) => cb(d)),
  onOrbSpeak:    (cb) => ipcRenderer.on("orb_speak",        (_, d) => cb(d)),
  onOrbMove:     (cb) => ipcRenderer.on("overlay_move_to",  (_, d) => cb(d)),
  onConnected:   (cb) => ipcRenderer.on("orb_connected",    (_, d) => cb(d)),

  // ── Enviar eventos al main process ────────────────────────────────
  setClickThrough: (enabled) => ipcRenderer.send("overlay_click_through", enabled),
  toggleChat:      ()        => ipcRenderer.send("overlay_toggle_chat"),
  requestFocus:    ()        => ipcRenderer.send("overlay_request_focus"),
});

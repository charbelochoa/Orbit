"use strict";

/**
 * Orbit AI — Overlay Preload Script
 * ─────────────────────────────────────────────────────────────────────────────
 * Context bridge para el overlay del pixel art orb.
 * Expone solo lo necesario para controlar el orbe desde el main process.
 */

const { contextBridge, ipcRenderer } = require("electron");

// ── Security: only allow these IPC channels ──────────────────────────────────
const ALLOWED_RECEIVE = new Set([
  "orb_state", "orb_speak", "overlay_move_to", "orb_connected", "orb_context",
]);
const ALLOWED_SEND = new Set([
  "overlay_click_through", "overlay_toggle_chat",
  "overlay_request_focus", "overlay_context_action",
]);

contextBridge.exposeInMainWorld("orbitOverlay", {
  // ── Recibir eventos del main process (filtered) ───────────────────
  onOrbState:    (cb) => { if (ALLOWED_RECEIVE.has("orb_state"))       ipcRenderer.on("orb_state",        (_, d) => cb(d)); },
  onOrbSpeak:    (cb) => { if (ALLOWED_RECEIVE.has("orb_speak"))       ipcRenderer.on("orb_speak",        (_, d) => cb(d)); },
  onOrbMove:     (cb) => { if (ALLOWED_RECEIVE.has("overlay_move_to")) ipcRenderer.on("overlay_move_to",  (_, d) => cb(d)); },
  onConnected:   (cb) => { if (ALLOWED_RECEIVE.has("orb_connected"))   ipcRenderer.on("orb_connected",    (_, d) => cb(d)); },
  onContext:     (cb) => { if (ALLOWED_RECEIVE.has("orb_context"))     ipcRenderer.on("orb_context",      (_, d) => cb(d)); },

  // ── Enviar eventos al main process (filtered) ─────────────────────
  setClickThrough: (enabled) => { if (ALLOWED_SEND.has("overlay_click_through")) ipcRenderer.send("overlay_click_through", !!enabled); },
  toggleChat:      ()        => { if (ALLOWED_SEND.has("overlay_toggle_chat"))   ipcRenderer.send("overlay_toggle_chat"); },
  requestFocus:    ()        => { if (ALLOWED_SEND.has("overlay_request_focus")) ipcRenderer.send("overlay_request_focus"); },
  contextAction:   (data)    => { if (ALLOWED_SEND.has("overlay_context_action") && data && typeof data === "object") ipcRenderer.send("overlay_context_action", data); },
});

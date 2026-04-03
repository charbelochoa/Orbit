/**
 * Orbit Notifications — Wake Word Monitor (Sprint 12)
 * ─────────────────────────────────────────────────────
 * Verifica cada transcripción de usuario en busca de una palabra clave
 * de activación (por defecto: "orbit" o "órbita").
 *
 * Cuando la detecta:
 *  1. Emite broadcast {type: "wake_word_detected"} → Electron muestra overlay
 *  2. Registra el evento para estadísticas
 *
 * Esto NO interrumpe la sesión Gemini — simplemente activa el overlay visualmente.
 * La detección es aditiva: si ya está respondiendo, la ventana aparece igualmente.
 */

import { createLogger } from "../infra/logger.js";
import { broadcast }    from "../gateway/server.js";
import { getConfig }    from "../config/config.js";

const log = createLogger("notify");

export class WakeWordMonitor {
    private _enabled  = false;
    private _phrases:  string[] = [];
    private _lastFire  = 0;
    private _cooldownMs = 5_000; // mínimo 5 s entre activaciones
    private _totalFires = 0;

    /** Inicia el monitor cargando la config. */
    start(): void {
        this._reload();
        log.info(`WakeWord monitor iniciado (frases: ${this._phrases.join(", ")})`);
    }

    stop(): void {
        this._enabled = false;
        log.info("WakeWord monitor detenido");
    }

    /** Recarga la config (por hot-reload). */
    private _reload(): void {
        const cfg = getConfig();
        const ww  = cfg.wakeWord;
        this._enabled   = ww?.enabled ?? false;
        this._phrases   = (ww?.phrases ?? ["orbit", "órbita"]).map(p => p.toLowerCase().trim());
        this._cooldownMs = (ww?.cooldownSec ?? 5) * 1000;
    }

    /**
     * Llamar con cada transcripción del usuario.
     * Si contiene la wake word y el cooldown pasó, dispara el evento.
     * @returns `true` si se detectó la wake word
     */
    check(text: string): boolean {
        if (!this._enabled || !this._phrases.length) return false;
        const lower = text.toLowerCase();
        const matched = this._phrases.find(p => lower.includes(p));
        if (!matched) return false;

        const now = Date.now();
        if (now - this._lastFire < this._cooldownMs) return false; // cooldown

        this._lastFire = now;
        this._totalFires++;
        log.info(`Wake word detectada: "${matched}" en "${text.slice(0, 60)}"`);

        broadcast({
            type:   "wake_word_detected",
            phrase: matched,
            text:   text.slice(0, 200),
            ts:     now,
        });

        return true;
    }

    isEnabled(): boolean { return this._enabled; }
    getTotalFires(): number { return this._totalFires; }
}

/** Singleton */
export const wakeWordMonitor = new WakeWordMonitor();

/**
 * Orbit Ambient — Mood / Energy Engine (Sprint 11)
 * ──────────────────────────────────────────────────
 * Infiere el "estado de trabajo" actual del usuario combinando:
 *   • Ventana activa + historial de ventanas (ambientService)
 *   • Patrón aprendido para esta hora/día (patternLearner)
 *   • Hora del día
 *   • Frecuencia de cambios de ventana (contexto fragmentado vs enfocado)
 *
 * No tiene dependencias externas fuera de los módulos Orbit.
 */

import { createLogger } from "../infra/logger.js";
import { ambientService } from "./service.js";
import { patternLearner } from "./pattern-learner.js";

const log = createLogger("ambient");

export type MoodState =
    | "focused"
    | "researching"
    | "browsing"
    | "switching"
    | "idle"
    | "email"
    | "entertainment"
    | "unknown";

export interface MoodSnapshot {
    state:       MoodState;
    app:         string | null;
    /** Minutos estimados en la app actual (basado en historial de la sesión) */
    minutesInApp: number;
    /** Cuántos cambios de ventana en los últimos 10 min */
    switchCount10m: number;
    /** App dominante esperada para esta hora según el patrón aprendido */
    expectedApp: string | null;
    /** true si el usuario está dentro de su rutina habitual */
    onRoutine:   boolean;
    ts:          number;
}

// ── Clasificación de apps ─────────────────────────────────────────────────────

const PRODUCTIVE_APPS = new Set([
    "code", "code - insiders", "devenv", "sublime_text", "atom", "notepad++",
    "webstorm64", "pycharm64", "intellij", "rider", "cursor",
    "cmd", "powershell", "pwsh", "windowsterminal", "wt",
    "node", "python", "cargo",
]);

const BROWSER_APPS = new Set([
    "chrome", "msedge", "firefox", "brave", "opera", "vivaldi", "arc",
]);

const EMAIL_APPS = new Set([
    "outlook", "thunderbird", "mimecast", "hiri",
]);

const ENTERTAINMENT_APPS = new Set([
    "spotify", "vlc", "mpc-hc64", "mpc-hc", "netflix", "steam",
    "discord",               // puede ser social/entertainment
    "slack",                  // comunicación (no exactamente entretenimiento)
]);

// Detecta modo investigación cuando el título tiene estas palabras clave
const RESEARCH_TITLE_KEYWORDS = [
    "stack overflow", "github", "mdn", "docs", "documentation",
    "gitlab", "npmjs", "pypi", "crates.io", "readthedocs",
    "dev.to", "medium", "hashnode", "codesandbox", "codepen",
];

// ── Motor ─────────────────────────────────────────────────────────────────────

export class MoodEngine {
    private _lastSnap: MoodSnapshot | null = null;
    private _appSince: number = Date.now(); // timestamp de cuándo comenzó la app actual
    private _lastApp: string | null = null;

    /** Calcula y devuelve el estado de ánimo/trabajo actual. */
    evaluate(): MoodSnapshot {
        const snap     = ambientService.getSnapshot();
        const now      = Date.now();
        const active   = snap.activeWindow;
        const history  = snap.windowHistory ?? [];
        const appName  = active?.app?.toLowerCase() ?? null;
        const title    = active?.title?.toLowerCase() ?? "";

        // ── Rastrear cuánto tiempo lleva en la app actual ──────────────────
        if (appName && appName !== this._lastApp) {
            this._appSince = now;
            this._lastApp  = appName;
        }
        const minutesInApp = Math.round((now - this._appSince) / 60_000);

        // ── Cambios de ventana en los últimos 10 min ───────────────────────
        const tenMinAgo     = now - 10 * 60_000;
        const switchCount10m = history.filter(h => h.ts >= tenMinAgo).length;

        // ── App esperada según rutina aprendida ───────────────────────────
        const expectedApp = patternLearner.getDominantApp();
        const onRoutine   = !!expectedApp && !!appName && expectedApp.includes(appName.slice(0, 6));

        // ── Inferencia de estado ──────────────────────────────────────────
        let state: MoodState = "unknown";

        if (!appName) {
            state = "idle";
        } else if (switchCount10m >= 8) {
            // Muchos cambios → contexto fragmentado
            state = "switching";
        } else if (minutesInApp < 1 && history.length > 2) {
            // Acaba de cambiar
            state = "switching";
        } else if (EMAIL_APPS.has(appName)) {
            state = "email";
        } else if (ENTERTAINMENT_APPS.has(appName)) {
            state = "entertainment";
        } else if (BROWSER_APPS.has(appName)) {
            const isResearch = RESEARCH_TITLE_KEYWORDS.some(k => title.includes(k));
            state = isResearch ? "researching" : "browsing";
        } else if (PRODUCTIVE_APPS.has(appName)) {
            state = "focused";
        } else if (minutesInApp >= 60) {
            // Mucho tiempo en cualquier app → el usuario está concentrado en algo
            state = "focused";
        } else {
            // Hora del día como último recurso
            const hour = new Date().getHours();
            if (hour < 8 || hour >= 22) {
                state = "idle";
            } else {
                state = "unknown";
            }
        }

        this._lastSnap = { state, app: appName, minutesInApp, switchCount10m, expectedApp, onRoutine, ts: now };
        log.debug(`Mood: ${state} (app: ${appName}, minutos: ${minutesInApp}, cambios10m: ${switchCount10m})`);
        return this._lastSnap;
    }

    getCached(): MoodSnapshot | null { return this._lastSnap; }
}

/** Singleton */
export const moodEngine = new MoodEngine();

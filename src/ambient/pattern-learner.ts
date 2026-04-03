/**
 * Orbit Ambient — Pattern Learner (Sprint 11)
 * ─────────────────────────────────────────────
 * Observa el historial de ventanas del WindowMonitor y construye un
 * mapa de rutinas por día-de-semana x hora del día.
 *
 * Estructura del patrón:
 *   patterns[dayOfWeek][hour] = { app: count }
 *
 * Se persiste en data/patterns.json para sobrevivir reinicios.
 * Expone `getDominantApp(hour, dow)` para que MoodEngine y la tool lo consulten.
 */

import fs   from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { createLogger } from "../infra/logger.js";
import type { WindowSnapshot } from "./types.js";

const log = createLogger("ambient");
const __dirname    = path.dirname(fileURLToPath(import.meta.url));
const PATTERNS_PATH = path.join(__dirname, "../../data/patterns.json");

// patterns[dow 0-6][hour 0-23][app] = count
type PatternMap = Record<number, Record<number, Record<string, number>>>;

function loadPatterns(): PatternMap {
    try {
        if (fs.existsSync(PATTERNS_PATH)) {
            return JSON.parse(fs.readFileSync(PATTERNS_PATH, "utf-8")) as PatternMap;
        }
    } catch { /* empty */ }
    return {};
}

function savePatterns(p: PatternMap): void {
    try {
        fs.mkdirSync(path.dirname(PATTERNS_PATH), { recursive: true });
        fs.writeFileSync(PATTERNS_PATH, JSON.stringify(p), "utf-8");
    } catch (e: any) {
        log.warn(`PatternLearner: no se pudo guardar: ${e.message}`);
    }
}

export class PatternLearner {
    private _patterns: PatternMap       = loadPatterns();
    private _saveTimer: ReturnType<typeof setTimeout> | null = null;
    /** Minutos acumulados por app en la sesión actual */
    private _sessionUsage: Record<string, number> = {};

    /** Llama esto cada vez que el WindowMonitor detecta una ventana nueva. */
    record(snap: WindowSnapshot): void {
        const d = new Date(snap.ts);
        const dow  = d.getDay();   // 0 = domingo
        const hour = d.getHours();
        const app  = snap.app.toLowerCase();

        if (!this._patterns[dow])        this._patterns[dow] = {};
        if (!this._patterns[dow][hour])  this._patterns[dow][hour] = {};
        this._patterns[dow][hour][app]   = (this._patterns[dow][hour][app] ?? 0) + 1;

        this._sessionUsage[app] = (this._sessionUsage[app] ?? 0) + 1;

        // Guardar de forma diferida (máx 1 escritura/5 min)
        if (!this._saveTimer) {
            this._saveTimer = setTimeout(() => {
                savePatterns(this._patterns);
                this._saveTimer = null;
            }, 5 * 60_000);
        }
    }

    /**
     * Devuelve la app más usada en un día/hora dado.
     * @param hour 0-23 (por defecto: hora actual)
     * @param dow  0-6  (por defecto: día actual)
     */
    getDominantApp(hour?: number, dow?: number): string | null {
        const d = new Date();
        const h = hour ?? d.getHours();
        const w = dow  ?? d.getDay();
        const bucket = this._patterns[w]?.[h];
        if (!bucket) return null;
        const entries = Object.entries(bucket);
        if (!entries.length) return null;
        return entries.sort((a, b) => b[1] - a[1])[0][0];
    }

    /** Mapa de las 5 apps más usadas HOY (suma de todas las horas) */
    getTopAppsToday(): Array<{ app: string; count: number }> {
        const dow = new Date().getDay();
        const total: Record<string, number> = {};
        const hourMap = this._patterns[dow] ?? {};
        for (const apps of Object.values(hourMap)) {
            for (const [app, cnt] of Object.entries(apps)) {
                total[app] = (total[app] ?? 0) + cnt;
            }
        }
        return Object.entries(total)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 5)
            .map(([app, count]) => ({ app, count }));
    }

    /** Minutos estimados por app en la sesión actual */
    getSessionUsage(): Record<string, number> {
        return { ...this._sessionUsage };
    }

    /** Cuántas veces se ha registrado esta app en la hora actual */
    getAppCount(app: string, hour?: number, dow?: number): number {
        const d = new Date();
        const h = hour ?? d.getHours();
        const w = dow  ?? d.getDay();
        return this._patterns[w]?.[h]?.[app.toLowerCase()] ?? 0;
    }

    flushAndSave(): void {
        if (this._saveTimer) {
            clearTimeout(this._saveTimer);
            this._saveTimer = null;
        }
        savePatterns(this._patterns);
    }
}

/** Singleton */
export const patternLearner = new PatternLearner();

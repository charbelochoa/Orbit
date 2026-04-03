/**
 * Orbit Proactive — Rule Engine (Sprint 11)
 * ──────────────────────────────────────────
 * Evalúa reglas de contexto-ambiental en intervalos regulares y notifica
 * al usuario cuando se cumplen condiciones relevantes.
 *
 * Reglas incorporadas:
 *  • idle_break      — misma app > 90 min → sugerir pausa
 *  • error_clipboard — portapapeles contiene stack trace → ofrecer ayuda
 *  • research_mode   — navegador con Stack Overflow / GitHub → ofrecer contexto
 *  • download_done   — nuevo archivo en ~/Downloads → informar
 *
 * El cooldown evita repetición. Cada regla se puede habilitar/deshabilitar
 * desde `orbit.yaml` (patterns.rules).
 */

import { createLogger }  from "../infra/logger.js";
import { broadcast }     from "../gateway/server.js";
import { ambientService } from "../ambient/service.js";
import { moodEngine }    from "../ambient/mood-engine.js";
import type { AmbientSnapshot } from "../ambient/types.js";
import type { MoodSnapshot }    from "../ambient/mood-engine.js";

const log = createLogger("proactive");

// ── Tipos ─────────────────────────────────────────────────────────────────────

export interface RuleResult {
    /** Mensaje corto para mostrar al usuario */
    message: string;
    /** Hint adicional para logs/debug */
    detail?: string;
}

export interface Rule {
    id:          string;
    /** Nombre legible */
    name:        string;
    /** Milisegundos mínimos entre disparos consecutivos */
    cooldownMs:  number;
    /** Evalúa si la regla debe dispararse. null = no disparar. */
    check(snap: AmbientSnapshot, mood: MoodSnapshot): RuleResult | null;
}

// ── Reglas incorporadas ───────────────────────────────────────────────────────

const BUILT_IN_RULES: Rule[] = [
    {
        id:         "idle_break",
        name:       "Recordatorio de pausa",
        cooldownMs: 90 * 60_000, // 90 min
        check(_snap, mood) {
            if (mood.minutesInApp >= 90 && mood.state === "focused") {
                return {
                    message: `Llevas ${mood.minutesInApp} min en ${mood.app ?? "la misma app"}. ¿Qué tal un descanso?`,
                    detail:  `estado: ${mood.state}`,
                };
            }
            return null;
        },
    },
    {
        id:         "error_clipboard",
        name:       "Error en portapapeles",
        cooldownMs: 15 * 60_000, // 15 min
        check(snap, _mood) {
            if (snap.recentClipboard?.type === "error") {
                const preview = (snap.recentClipboard.text ?? "").slice(0, 60);
                return {
                    message: `Detecté un error en tu portapapeles: "${preview}…". ¿Te ayudo a resolverlo?`,
                    detail:  "clipboard.type === error",
                };
            }
            return null;
        },
    },
    {
        id:         "research_mode",
        name:       "Modo investigación",
        cooldownMs: 30 * 60_000, // 30 min
        check(_snap, mood) {
            if (mood.state === "researching") {
                return {
                    message: `Veo que estás investigando en ${mood.app ?? "el navegador"}. ¿Te ayudo con contexto o buscas algo específico?`,
                    detail:  "mood.state === researching",
                };
            }
            return null;
        },
    },
    {
        id:         "download_arrived",
        name:       "Descarga completada",
        cooldownMs: 5 * 60_000, // 5 min
        check(snap, _mood) {
            if (snap.recentDownloads && snap.recentDownloads.length > 0) {
                const newest = snap.recentDownloads[0];
                if (!newest) return null;
                // Solo disparar si la descarga es reciente (< 3 min)
                if (Date.now() - newest.ts < 3 * 60_000) {
                    return {
                        message: `Llegó "${newest.file}". ¿Lo abro o proceso?`,
                        detail:  `ext: ${newest.ext}`,
                    };
                }
            }
            return null;
        },
    },
    {
        id:         "context_switch_warning",
        name:       "Muchos cambios de contexto",
        cooldownMs: 45 * 60_000, // 45 min
        check(_snap, mood) {
            if (mood.switchCount10m >= 10) {
                return {
                    message: `Detecté ${mood.switchCount10m} cambios de ventana en los últimos 10 min. ¿Te ayudo a priorizar o necesitas concentración?`,
                    detail:  `switchCount10m: ${mood.switchCount10m}`,
                };
            }
            return null;
        },
    },
];

// ── Motor ─────────────────────────────────────────────────────────────────────

class RuleEngine {
    private _running  = false;
    private _timer:   ReturnType<typeof setInterval> | null = null;
    /** Timestamp del último disparo por regla */
    private _lastFire: Record<string, number> = {};
    /** Reglas deshabilitadas por config */
    private _disabled: Set<string> = new Set();

    /**
     * Inicia el motor con el intervalo indicado.
     * @param intervalMs intervalo de evaluación (por defecto 60 s)
     * @param disabledRules IDs de reglas a deshabilitar
     */
    start(intervalMs = 60_000, disabledRules: string[] = []): void {
        if (this._running) return;
        this._running  = true;
        this._disabled = new Set(disabledRules);

        this._timer = setInterval(() => this._evaluate(), intervalMs);
        log.info(`Rule engine iniciado (intervalo: ${intervalMs / 1000}s, reglas: ${BUILT_IN_RULES.length})`);
    }

    stop(): void {
        if (!this._running) return;
        this._running = false;
        if (this._timer) { clearInterval(this._timer); this._timer = null; }
        log.info("Rule engine detenido");
    }

    isRunning(): boolean { return this._running; }

    /** Fuerza una evaluación inmediata (útil para testing). */
    evaluateNow(): void { this._evaluate(); }

    private _evaluate(): void {
        if (!ambientService.isRunning()) return; // sin datos ambientales

        const snap = ambientService.getSnapshot();
        const mood = moodEngine.evaluate();
        const now  = Date.now();

        for (const rule of BUILT_IN_RULES) {
            if (this._disabled.has(rule.id)) continue;

            const lastFire = this._lastFire[rule.id] ?? 0;
            if (now - lastFire < rule.cooldownMs) continue; // en cooldown

            let result: RuleResult | null = null;
            try {
                result = rule.check(snap, mood);
            } catch (e: any) {
                log.warn(`Error evaluando regla "${rule.id}": ${e.message}`);
                continue;
            }

            if (result) {
                this._lastFire[rule.id] = now;
                log.info(`Regla disparada: ${rule.id} — ${result.message}`);
                broadcast({
                    type:    "ambient_rule_triggered",
                    ruleId:  rule.id,
                    name:    rule.name,
                    message: result.message,
                    detail:  result.detail ?? "",
                    ts:      now,
                });
            }
        }
    }

    /** Estado de todas las reglas (para /status). */
    getStatus(): Array<{ id: string; name: string; enabled: boolean; lastFire: number | null; cooldownMs: number }> {
        return BUILT_IN_RULES.map(r => ({
            id:        r.id,
            name:      r.name,
            enabled:   !this._disabled.has(r.id),
            // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
            lastFire:  this._lastFire[r.id] ?? null,
            cooldownMs: r.cooldownMs,
        }));
    }
}

/** Singleton */
export const ruleEngine = new RuleEngine();

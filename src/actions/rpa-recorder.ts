/**
 * Orbit RPA Recorder — Sprint 7
 *
 * Records, stores, replays and exports human-in-the-loop UI automation sequences.
 * Each recorded session becomes a replayable "macro" that can also be exported
 * as a SKILL.md so the AI can describe/invoke it by name.
 *
 * Concepts:
 *   RpaStep      — Normalised descriptor of a single action
 *   RpaRecording — Named sequence of steps + metadata
 *   Sessions     — In-memory ephemeral state (recording in progress)
 *   Macros       — Persisted to disk at data/rpa/<id>.json
 *
 * Public API (also exposed as tool `rpa_record`):
 *   start(name)           → begin recording, return session id
 *   step(sessionId, step) → append a step to the active recording
 *   stop(sessionId)       → finalise + persist
 *   list()                → list all saved macros
 *   get(id)               → load a specific macro
 *   replay(id, opts?)     → execute each step via computerControl
 *   delete(id)            → remove a macro file
 *   export(id)            → generate a SKILL.md from the macro
 *   installAsSkill(id)    → write the SKILL.md into skills/<id>/SKILL.md
 */

import fs            from "fs/promises";
import path          from "path";
import { fileURLToPath } from "url";
import { createLogger }  from "../infra/logger.js";
import { computerControl } from "./computer-control.js";

const log       = createLogger("rpa-recorder");
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MACROS_DIR = path.join(__dirname, "../../data/rpa");

// ── Types ────────────────────────────────────────────────────────────────────

export type RpaActionType =
    | "click" | "double_click" | "right_click"
    | "type" | "hotkey" | "press"
    | "scroll" | "move"
    | "wait" | "focus_window" | "screenshot";

export interface RpaStep {
    action:    RpaActionType;
    /** Coordinates for mouse actions */
    x?:        number;
    y?:        number;
    /** Text to type */
    text?:     string;
    /** Key(s) to press / hotkey */
    key?:      string;
    keys?:     string;
    /** Scroll direction */
    direction?: string;
    amount?:   number;
    /** Wait seconds */
    seconds?:  number;
    /** Window name */
    app?:      string;
    /** Human-readable comment auto-generated */
    comment?:  string;
    /** Timestamp relative to recording start (ms) */
    t?: number;
}

export interface RpaRecording {
    id:          string;
    name:        string;
    description: string;
    steps:       RpaStep[];
    createdAt:   number;
    durationMs?: number;
    stepCount:   number;
    tags:        string[];
}

export interface ReplayOptions {
    /** Speed multiplier (default: 1.0) — affects wait steps only */
    speed?:    number;
    /** Add a fixed delay (ms) between steps (default: 200) */
    stepDelay?: number;
    /** Stop on first error (default: true) */
    stopOnError?: boolean;
    /** Loop N times (default: 1) */
    loops?: number;
}

export interface ReplayResult {
    success:     boolean;
    stepsRan:    number;
    errors:      Array<{ step: number; error: string }>;
    durationMs:  number;
}

// ── Active recordings (in-memory) ────────────────────────────────────────────

interface ActiveSession {
    id:        string;
    name:      string;
    steps:     RpaStep[];
    startedAt: number;
    tags:      string[];
}

const _sessions = new Map<string, ActiveSession>();

// ── ID generator ─────────────────────────────────────────────────────────────

function genId(): string {
    return `rpa_${Date.now().toString(36)}`;
}

// ── Macro I/O ─────────────────────────────────────────────────────────────────

async function ensureDir(): Promise<void> {
    await fs.mkdir(MACROS_DIR, { recursive: true });
}

async function saveMacro(rec: RpaRecording): Promise<void> {
    await ensureDir();
    await fs.writeFile(
        path.join(MACROS_DIR, `${rec.id}.json`),
        JSON.stringify(rec, null, 2),
        "utf-8",
    );
}

// ── Start ─────────────────────────────────────────────────────────────────────

export function startRecording(name: string, tags: string[] = []): string {
    const id: string = genId();
    _sessions.set(id, { id, name, steps: [], startedAt: Date.now(), tags });
    log.info(`Grabación iniciada [${id}] "${name}"`);
    return id;
}

// ── Append step ───────────────────────────────────────────────────────────────

export function appendStep(sessionId: string, step: RpaStep): void {
    const session = _sessions.get(sessionId);
    if (!session) throw new Error(`Sesión de grabación '${sessionId}' no encontrada.`);
    // Annotate with elapsed time
    step.t = Date.now() - session.startedAt;
    // Auto-comment for readability
    if (!step.comment) step.comment = _autoComment(step);
    session.steps.push(step);
    log.debug(`Paso añadido [${sessionId}] ${step.action}`);
}

function _autoComment(step: RpaStep): string {
    switch (step.action) {
        case "click":        return `Click en (${step.x}, ${step.y})`;
        case "double_click": return `Doble click en (${step.x}, ${step.y})`;
        case "right_click":  return `Click derecho en (${step.x}, ${step.y})`;
        case "type":         return `Escribir: "${(step.text || "").slice(0, 40)}"`;
        case "hotkey":       return `Atajo: ${step.keys}`;
        case "press":        return `Tecla: ${step.key}`;
        case "scroll":       return `Scroll ${step.direction} x${step.amount}`;
        case "move":         return `Mover ratón a (${step.x}, ${step.y})`;
        case "wait":         return `Esperar ${step.seconds}s`;
        case "focus_window": return `Enfocar ventana: ${step.app}`;
        case "screenshot":   return `Captura de pantalla`;
        default:             return step.action;
    }
}

// ── Stop + persist ────────────────────────────────────────────────────────────

export async function stopRecording(
    sessionId: string,
    description = "",
): Promise<RpaRecording> {
    const session = _sessions.get(sessionId);
    if (!session) throw new Error(`Sesión '${sessionId}' no encontrada.`);

    const rec: RpaRecording = {
        id:          session.id,
        name:        session.name,
        description: description || `Grabación de ${session.steps.length} pasos`,
        steps:       session.steps,
        createdAt:   session.startedAt,
        durationMs:  Date.now() - session.startedAt,
        stepCount:   session.steps.length,
        tags:        session.tags,
    };

    await saveMacro(rec);
    _sessions.delete(sessionId);
    log.info(`Grabación guardada [${rec.id}] "${rec.name}" — ${rec.stepCount} pasos`);
    return rec;
}

// ── List ──────────────────────────────────────────────────────────────────────

export async function listMacros(): Promise<RpaRecording[]> {
    await ensureDir();
    const files = await fs.readdir(MACROS_DIR);
    const macros: RpaRecording[] = [];
    for (const f of files.filter(f => f.endsWith(".json"))) {
        try {
            const raw = await fs.readFile(path.join(MACROS_DIR, f), "utf-8");
            macros.push(JSON.parse(raw) as RpaRecording);
        } catch { /* skip corrupt */ }
    }
    return macros.sort((a, b) => b.createdAt - a.createdAt);
}

// ── Get ───────────────────────────────────────────────────────────────────────

export async function getMacro(id: string): Promise<RpaRecording | null> {
    try {
        const raw = await fs.readFile(path.join(MACROS_DIR, `${id}.json`), "utf-8");
        return JSON.parse(raw) as RpaRecording;
    } catch {
        return null;
    }
}

// ── Delete ────────────────────────────────────────────────────────────────────

export async function deleteMacro(id: string): Promise<boolean> {
    try {
        await fs.unlink(path.join(MACROS_DIR, `${id}.json`));
        log.info(`Macro eliminada: ${id}`);
        return true;
    } catch {
        return false;
    }
}

// ── Replay ───────────────────────────────────────────────────────────────────

export async function replayMacro(
    id: string,
    opts: ReplayOptions = {},
): Promise<ReplayResult> {
    const rec = await getMacro(id);
    if (!rec) throw new Error(`Macro '${id}' no encontrada.`);

    const speed     = opts.speed      ?? 1.0;
    const stepDelay = opts.stepDelay  ?? 200;
    const stopOnErr = opts.stopOnError ?? true;
    const loops     = Math.max(1, opts.loops ?? 1);

    const result: ReplayResult = {
        success:    true,
        stepsRan:   0,
        errors:     [],
        durationMs: 0,
    };

    const t0 = Date.now();

    for (let loop = 0; loop < loops; loop++) {
        for (let i = 0; i < rec.steps.length; i++) {
            const step = rec.steps[i];
            try {
                // Adjust wait durations for speed multiplier
                const adjusted = { ...step };
                if (adjusted.action === "wait" && adjusted.seconds) {
                    adjusted.seconds = adjusted.seconds / speed;
                }

                await computerControl(adjusted);
                result.stepsRan++;

                // Inter-step delay
                if (i < rec.steps.length - 1 && stepDelay > 0) {
                    await new Promise(r => setTimeout(r, stepDelay));
                }
            } catch (err: any) {
                const msg = err.message || String(err);
                result.errors.push({ step: i + 1, error: msg });
                log.warn(`Error en paso ${i + 1} (${step.action}):`, msg);
                if (stopOnErr) {
                    result.success = false;
                    result.durationMs = Date.now() - t0;
                    return result;
                }
            }
        }
    }

    result.durationMs = Date.now() - t0;
    result.success    = result.errors.length === 0;
    return result;
}

// ── Export as SKILL.md ────────────────────────────────────────────────────────

export function exportAsSkill(rec: RpaRecording): string {
    const safeName = rec.name.replace(/[^a-zA-Z0-9-_ ]/g, "").trim();
    const slug = safeName.toLowerCase().replace(/\s+/g, "-");
    const tags = rec.tags.length > 0 ? rec.tags : ["automation", "rpa"];

    const stepsMarkdown = rec.steps.map((s, i) =>
        `${i + 1}. **${s.action}** — ${s.comment || _autoComment(s)}`
    ).join("\n");

    const toolCalls = rec.steps.map(s => {
        const params = Object.entries(s)
            .filter(([k]) => !["comment", "t"].includes(k))
            .map(([k, v]) => `    ${k}: ${JSON.stringify(v)}`)
            .join("\n");
        return `- tool: computer_control\n  params:\n${params}`;
    }).join("\n");

    return `---
name: "${safeName}"
description: "${rec.description}"
category: "automation"
emoji: "🤖"
tags: [${tags.map(t => `"${t}"`).join(", ")}]
version: "1.0.0"
source: "rpa-recorder"
recorded: "${new Date(rec.createdAt).toISOString()}"
steps: ${rec.stepCount}
---

# ${safeName}

${rec.description}

## Cuándo usar

Usa esta skill cuando necesites automatizar la siguiente secuencia de pasos en la UI:

${stepsMarkdown}

## Pasos detallados

\`\`\`yaml
${toolCalls}
\`\`\`

## Ejecución directa

Para reproducir esta macro exactamente, invoca:

\`\`\`
rpa_record action=replay id=${rec.id}
\`\`\`

## Notas

- Grabado el: ${new Date(rec.createdAt).toLocaleString("es-ES")}
- Duración original: ${rec.durationMs ? (rec.durationMs / 1000).toFixed(1) + "s" : "desconocida"}
- Pasos: ${rec.stepCount}
`;
}

// ── Install as Skill ─────────────────────────────────────────────────────────

export async function installMacroAsSkill(id: string): Promise<string> {
    const rec = await getMacro(id);
    if (!rec) throw new Error(`Macro '${id}' no encontrada.`);

    const slug = rec.name.toLowerCase().replace(/[^a-z0-9-_]/g, "-").replace(/-+/g, "-");
    const skillDir  = path.join(__dirname, "../../skills", slug);
    const skillPath = path.join(skillDir, "SKILL.md");

    await fs.mkdir(skillDir, { recursive: true });
    await fs.writeFile(skillPath, exportAsSkill(rec), "utf-8");
    log.info(`Skill exportada: ${skillPath}`);
    return skillPath;
}

// ── Active session status ─────────────────────────────────────────────────────

export function getActiveSessions(): Array<{ id: string; name: string; steps: number; elapsedMs: number }> {
    return Array.from(_sessions.values()).map(s => ({
        id:        s.id,
        name:      s.name,
        steps:     s.steps.length,
        elapsedMs: Date.now() - s.startedAt,
    }));
}

// ── Tool handler (rpa_record) ─────────────────────────────────────────────────

export async function rpaRecord(args: any): Promise<string> {
    const action = (args?.action || "list").toLowerCase();

    switch (action) {
        // ── start recording ───────────────────────────────────────────────────
        case "start": {
            const name = (args?.name || "Grabación sin nombre").trim();
            const tags = Array.isArray(args?.tags) ? args.tags : [];
            const id   = startRecording(name, tags);
            return `🔴 Grabación iniciada.\nID: \`${id}\`\nNombre: ${name}\n\nAhora ejecuta acciones con \`computer_control\` y añade cada paso con \`rpa_record action=step\`.`;
        }

        // ── append a step to active session ───────────────────────────────────
        case "step": {
            const sessionId = (args?.session_id || "").trim();
            if (!sessionId) return "Falta 'session_id'. Inicia una grabación con action=start primero.";
            const step: RpaStep = {
                action:    args.step_action || "click",
                x:         args.x,
                y:         args.y,
                text:      args.text,
                key:       args.key,
                keys:      args.keys,
                direction: args.direction,
                amount:    args.amount,
                seconds:   args.seconds,
                app:       args.app,
                comment:   args.comment,
            };
            // Remove undefined keys
            for (const k of Object.keys(step) as Array<keyof RpaStep>) {
                if (step[k] === undefined) delete step[k];
            }
            appendStep(sessionId, step);
            const session = getActiveSessions().find(s => s.id === sessionId);
            return `✅ Paso añadido (${step.action}). Total pasos: ${session?.steps ?? "?"}.`;
        }

        // ── stop + persist ────────────────────────────────────────────────────
        case "stop": {
            const sessionId = (args?.session_id || "").trim();
            if (!sessionId) return "Falta 'session_id'.";
            const description = args?.description || "";
            const rec = await stopRecording(sessionId, description);
            return `⏹️ Grabación guardada.\nID: \`${rec.id}\`\nPasos: ${rec.stepCount}\nDuración: ${((rec.durationMs || 0) / 1000).toFixed(1)}s`;
        }

        // ── list ──────────────────────────────────────────────────────────────
        case "list": {
            const macros = await listMacros();
            if (macros.length === 0) return "No hay macros grabadas aún. Usa `rpa_record action=start name=<nombre>` para empezar.";
            const lines = macros.map(m =>
                `- \`${m.id}\` **${m.name}** — ${m.stepCount} pasos (${new Date(m.createdAt).toLocaleDateString("es-ES")})`
            );
            return `**Macros RPA (${macros.length}):**\n${lines.join("\n")}`;
        }

        // ── replay ────────────────────────────────────────────────────────────
        case "replay": {
            const id = (args?.id || "").trim();
            if (!id) return "Falta 'id' de la macro a reproducir.";
            const opts: ReplayOptions = {
                speed:       typeof args.speed === "number"      ? args.speed      : 1.0,
                stepDelay:   typeof args.step_delay === "number" ? args.step_delay : 200,
                stopOnError: args.stop_on_error !== false,
                loops:       typeof args.loops === "number"      ? args.loops      : 1,
            };
            const result = await replayMacro(id, opts);
            const status = result.success ? "✅ Completado" : "⚠️ Completado con errores";
            const errLines = result.errors.map(e => `  - Paso ${e.step}: ${e.error}`).join("\n");
            return `${status}\nPasos ejecutados: ${result.stepsRan} | Tiempo: ${(result.durationMs / 1000).toFixed(1)}s${result.errors.length > 0 ? `\n\nErrores:\n${errLines}` : ""}`;
        }

        // ── delete ────────────────────────────────────────────────────────────
        case "delete": {
            const id = (args?.id || "").trim();
            if (!id) return "Falta 'id' de la macro a eliminar.";
            const ok = await deleteMacro(id);
            return ok ? `🗑️ Macro \`${id}\` eliminada.` : `No se encontró la macro \`${id}\`.`;
        }

        // ── export as skill ───────────────────────────────────────────────────
        case "export": {
            const id = (args?.id || "").trim();
            if (!id) return "Falta 'id' de la macro a exportar.";
            const rec = await getMacro(id);
            if (!rec) return `Macro \`${id}\` no encontrada.`;
            const md = exportAsSkill(rec);
            return `**SKILL.md generado para "${rec.name}":**\n\n\`\`\`markdown\n${md.slice(0, 2000)}${md.length > 2000 ? "\n... (truncado)" : ""}\n\`\`\``;
        }

        // ── install as skill ──────────────────────────────────────────────────
        case "install_skill": {
            const id = (args?.id || "").trim();
            if (!id) return "Falta 'id' de la macro.";
            const skillPath = await installMacroAsSkill(id);
            return `✅ Macro instalada como skill en:\n${skillPath}\n\nUsa \`/skill list\` para verla activa.`;
        }

        // ── status (active sessions) ──────────────────────────────────────────
        case "status": {
            const active = getActiveSessions();
            if (active.length === 0) return "No hay grabaciones activas.";
            const lines = active.map(s =>
                `- \`${s.id}\` **${s.name}** — ${s.steps} pasos | ${(s.elapsedMs / 1000).toFixed(0)}s`
            );
            return `**Grabaciones activas (${active.length}):**\n${lines.join("\n")}`;
        }

        // ── get details ───────────────────────────────────────────────────────
        case "get": {
            const id = (args?.id || "").trim();
            if (!id) return "Falta 'id'.";
            const rec = await getMacro(id);
            if (!rec) return `Macro \`${id}\` no encontrada.`;
            const steps = rec.steps.map((s, i) => `  ${i + 1}. ${s.comment || _autoComment(s)}`).join("\n");
            return `**${rec.name}** (\`${rec.id}\`)\n${rec.description}\nPasos: ${rec.stepCount}\n\n${steps}`;
        }

        default:
            return `Acción '${action}' desconocida.\nOpciones: start | step | stop | list | replay | delete | export | install_skill | status | get`;
    }
}

/**
 * Orbit Configuration Schema
 * Phase 0.2 — Zod-based validation for all Orbit config.
 */

import { z } from "zod";

const providerSchema = z.object({
    apiKey:  z.string().default(""),
    baseUrl: z.string().default(""),
    models:  z.record(z.string(), z.string()).default({}),
});

type ProviderDefaults = z.infer<typeof providerSchema>;
const defaultProvider = (): ProviderDefaults => ({ apiKey: "", baseUrl: "", models: {} });

export const orbitConfigSchema = z.object({
    providers: z.object({
        gemini:    providerSchema.default(defaultProvider),
        openai:    providerSchema.default(defaultProvider),
        anthropic: providerSchema.default(defaultProvider),
        ollama:    providerSchema.default(defaultProvider),
    }).default(() => ({
        gemini:    defaultProvider(),
        openai:    defaultProvider(),
        anthropic: defaultProvider(),
        ollama:    defaultProvider(),
    })),

    defaultProvider: z.enum(["gemini", "openai", "anthropic", "ollama"]).default("gemini"),

    fallbackChain: z.array(z.object({
        provider: z.string(),
        model:    z.string(),
    })).default([]),

    voice: z.object({
        voiceName: z.string().default("Aoede"),
        language:  z.string().default("es"),
    }).default(() => ({ voiceName: "Aoede", language: "es" })),

    toolProfile: z.enum(["minimal", "standard", "coding", "full"]).default("full"),

    security: z.object({
        approvalRequired: z.boolean().default(false),
        allowedPaths:     z.array(z.string()).default([]),
    }).default(() => ({ approvalRequired: false, allowedPaths: [] as string[] })),

    server: z.object({
        gatewayPort: z.number().default(18789),
        webPort:     z.number().default(3000),
    }).default(() => ({ gatewayPort: 18789, webPort: 3000 })),

    engine: z.object({
        pythonPort:        z.number().default(18790),
        heartbeatInterval: z.number().default(30000),
    }).default(() => ({ pythonPort: 18790, heartbeatInterval: 30000 })),

    logging: z.object({
        level: z.enum(["debug", "info", "warn", "error"]).default("info"),
        /** Per-subsystem log level overrides. Keys: skills, context, plugins, memory, agent, etc. */
        subsystems: z.record(
            z.string(),
            z.enum(["debug", "info", "warn", "error"]),
        ).default({}),
    }).default(() => ({ level: "info" as const, subsystems: {} as Record<string, "debug" | "info" | "warn" | "error"> })),

    /**
     * Visual Memory — Sprint 6
     * Automatically captions & indexes screenshots into the vector store.
     */
    memory: z.object({
        visual: z.object({
            /** Enable visual memory capture */
            enabled:        z.boolean().default(false),
            /** Auto-capture a screenshot after every agent turn */
            captureOnTurn:  z.boolean().default(false),
            /** Caption model — must be a multimodal Gemini model */
            captionModel:   z.string().default("gemini-2.5-flash"),
            /** Days to keep screenshot entries before pruning */
            retentionDays:  z.number().default(7),
        }).default(() => ({ enabled: false, captureOnTurn: false, captionModel: "gemini-2.5-flash", retentionDays: 7 })),
    }).default(() => ({
        visual: { enabled: false, captureOnTurn: false, captionModel: "gemini-2.5-flash", retentionDays: 7 },
    })),

    /**
     * Proactive Triggers — Sprint 5
     * File watchers + cron schedules that fire AgentExecutor goals automatically.
     */
    proactive: z.object({
        enabled: z.boolean().default(false),
        /** File-watch triggers */
        watchers: z.array(z.object({
            id:      z.string(),
            /** Glob pattern(s) to watch, relative to cwd */
            glob:    z.union([z.string(), z.array(z.string())]),
            /** Only fire on these fs events */
            on:      z.array(z.enum(["add", "change", "unlink"])).default(["change"]),
            /** Goal template. Use {{file}} and {{event}} as placeholders */
            goal:    z.string(),
            /** Debounce window in ms (default 1500) */
            debounce: z.number().default(1500),
            /** Ignore patterns (globs) */
            ignore:  z.array(z.string()).default([]),
            enabled: z.boolean().default(true),
        })).default([]),
        /** Cron-scheduled triggers */
        schedules: z.array(z.object({
            id:       z.string(),
            /** Cron expression e.g. "0 * * * *" or shorthand "@hourly" */
            cron:     z.string(),
            /** Goal to execute on schedule */
            goal:     z.string(),
            /** Timezone for the cron (default: system) */
            timezone: z.string().optional(),
            enabled:  z.boolean().default(true),
        })).default([]),
    }).default(() => ({ enabled: false, watchers: [], schedules: [] })),

    /**
     * Ambient Awareness Engine — Sprint 9
     * Detecta ventana activa, portapapeles y descargas en tiempo real.
     */
    ambient: z.object({
        enabled: z.boolean().default(false),
        window: z.object({
            enabled:        z.boolean().default(true),
            pollIntervalMs: z.number().default(5000),
            historySize:    z.number().default(10),
        }).default(() => ({ enabled: true, pollIntervalMs: 5000, historySize: 10 })),
        clipboard: z.object({
            enabled:        z.boolean().default(true),
            pollIntervalMs: z.number().default(2000),
            minLength:      z.number().default(3),
            maxLength:      z.number().default(5000),
            notifyOnUrl:    z.boolean().default(true),
            notifyOnCode:   z.boolean().default(false),
            notifyOnError:  z.boolean().default(true),
        }).default(() => ({ enabled: true, pollIntervalMs: 2000, minLength: 3, maxLength: 5000, notifyOnUrl: true, notifyOnCode: false, notifyOnError: true })),
        downloads: z.object({
            enabled:         z.boolean().default(true),
            notifyOnNew:     z.boolean().default(true),
            watchExtensions: z.array(z.string()).default(["pdf","zip","exe","docx","xlsx","pptx","mp4","mp3","png","jpg","jpeg"]),
        }).default(() => ({ enabled: true, notifyOnNew: true, watchExtensions: ["pdf","zip","exe","docx","xlsx","pptx","mp4","mp3","png","jpg","jpeg"] })),
    }).default(() => ({
        enabled:   false,
        window:    { enabled: true, pollIntervalMs: 5000, historySize: 10 },
        clipboard: { enabled: true, pollIntervalMs: 2000, minLength: 3, maxLength: 5000, notifyOnUrl: true, notifyOnCode: false, notifyOnError: true },
        downloads: { enabled: true, notifyOnNew: true, watchExtensions: ["pdf","zip","exe","docx","xlsx","pptx","mp4","mp3","png","jpg","jpeg"] },
    })),

    /**
     * Daily Briefing — Sprint 10
     * Configura el briefing diario de Orbit.
     */
    briefing: z.object({
        /** Ciudad para el reporte del clima (vacío = auto-detect por IP) */
        city: z.string().default(""),
    }).default(() => ({ city: "" })),

    /**
     * Pattern Learning & Rule Engine — Sprint 11
     * Control del aprendizaje de rutinas y las reglas proactivas de contexto.
     */
    patterns: z.object({
        /** Habilitar el aprendizaje de patrones de uso */
        enabled: z.boolean().default(true),
        /** Intervalo de evaluación del rule engine en segundos */
        ruleIntervalSec: z.number().default(60),
        /** IDs de reglas incorporadas a deshabilitar */
        disabledRules: z.array(z.string()).default([]),
    }).default(() => ({ enabled: true, ruleIntervalSec: 60, disabledRules: [] as string[] })),

    /**
     * Toast Notifications — Sprint 12
     * Controla qué eventos generan notificaciones del sistema operativo.
     */
    notifications: z.object({
        /** Habilitar el servicio de notificaciones */
        enabled: z.boolean().default(true),
        /** Mostrar notificación al arrancar Orbit */
        notifyOnStartup: z.boolean().default(true),
        /** IDs de eventos/reglas a silenciar (ej: ["startup", "idle_break"]) */
        silenced: z.array(z.string()).default([]),
    }).default(() => ({ enabled: true, notifyOnStartup: true, silenced: [] as string[] })),

    /**
     * Wake Word — Sprint 12
     * Detecta una palabra clave en la transcripción del usuario para activar el overlay.
     */
    wakeWord: z.object({
        /** Habilitar detección de wake word */
        enabled: z.boolean().default(false),
        /** Frases a detectar (case-insensitive, substring match) */
        phrases: z.array(z.string()).default(["orbit", "órbita"]),
        /** Segundos mínimos entre activaciones consecutivas */
        cooldownSec: z.number().default(5),
    }).default(() => ({ enabled: false, phrases: ["orbit", "órbita"], cooldownSec: 5 })),

    /**
     * Codebase Semantic Index + Error Watcher — Sprint 13
     */
    codebase: z.object({
        /** Activar el indexer semántico del codebase */
        enabled: z.boolean().default(false),
        /** Raíz del proyecto a indexar (vacío = cwd) */
        root: z.string().default(""),
        /** Extensiones a incluir en el índice */
        extensions: z.array(z.string()).default([".ts", ".tsx", ".js", ".py", ".md"]),
        /** Globs adicionales a excluir */
        excludePatterns: z.array(z.string()).default([]),
        /** Error watcher — ejecuta tsc --noEmit en segundo plano */
        errorWatcher: z.object({
            enabled: z.boolean().default(false),
            /** Intervalo mínimo entre compilaciones (segundos) */
            minIntervalSec: z.number().default(30),
        }).default(() => ({ enabled: false, minIntervalSec: 30 })),
    }).default(() => ({
        enabled: false,
        root: "",
        extensions: [".ts", ".tsx", ".js", ".py", ".md"],
        excludePatterns: [],
        errorWatcher: { enabled: false, minIntervalSec: 30 },
    })),

    /**
     * Agent Executor — Phase 1 safety limits
     */
    agent: z.object({
        /** Maximum steps a single plan can have before rejection */
        maxPlanSteps: z.number().default(30),
        /** Maximum replan attempts before aborting */
        maxReplans:   z.number().default(3),
        /** Maximum loops for the visual agent loop (Phase 2) */
        maxVisualLoops: z.number().default(25),
    }).default(() => ({ maxPlanSteps: 30, maxReplans: 3, maxVisualLoops: 25 })),
});

export type OrbitConfig = z.infer<typeof orbitConfigSchema>;

import { GoogleGenAI } from "@google/genai";
import dotenv from "dotenv";

dotenv.config();

export enum ErrorDecision {
    RETRY = "RETRY",
    SKIP = "SKIP",
    REPLAN = "REPLAN",
    ABORT = "ABORT",
}

export interface ErrorAnalysis {
    decision: ErrorDecision;
    user_message?: string;
    reason?: string;
    alternative_step?: { tool: string; description: string; parameters: Record<string, any> };
}

// Patrones de errores conocidos → decisión automática sin llamar al LLM
const KNOWN_ERRORS: Array<{ pattern: RegExp; decision: ErrorDecision; message: string }> = [
    { pattern: /timeout/i,                  decision: ErrorDecision.RETRY, message: "Tomó más tiempo de lo esperado, reintentando..." },
    { pattern: /network|ECONNREFUSED/i,     decision: ErrorDecision.RETRY, message: "Problema de red, reintentando..." },
    { pattern: /ENOENT|not found/i,         decision: ErrorDecision.SKIP,  message: "Archivo no encontrado, continuando con el siguiente paso." },
    { pattern: /permission denied|EPERM/i,  decision: ErrorDecision.ABORT, message: "Sin permisos para completar esa operación." },
    { pattern: /API key|authentication/i,   decision: ErrorDecision.ABORT, message: "Error de autenticación. Verifica tu API key." },
];

/**
 * Análisis LLM de errores desconocidos. Se invoca cuando los patrones regex no hacen match.
 */
async function analyzeErrorWithLLM(
    tool: string,
    errorMsg: string,
    stepDescription: string,
    goal: string
): Promise<ErrorAnalysis> {
    try {
        const apiKey = process.env.GEMINI_API_KEY;
        if (!apiKey) throw new Error("No API key");

        const ai = new GoogleGenAI({ apiKey });
        const prompt = `You are a fault-recovery module for an AI agent. A step failed during task execution:
- Goal: ${goal}
- Tool: ${tool}
- Step description: ${stepDescription}
- Error: ${errorMsg} Decide the best recovery action:
- RETRY: transient/timing error that may work on a second try
- SKIP: non-critical step, continue with the next one
- REPLAN: fundamental approach is wrong, need a different plan
- ABORT: impossible to continue (permissions, auth, safety) Respond ONLY with valid JSON:
{"decision": "RETRY|SKIP|REPLAN|ABORT", "reason": "brief reason", "user_message": "friendly message in Spanish for the user"}`;

        const response = await ai.models.generateContent({
            model: "gemini-2.5-flash-lite",
            contents: [{ role: "user", parts: [{ text: prompt }] }],
        });

        let text = response.text || "{}";
        text = text.replace(/```(json)?/gi, "").trim();
        const parsed = JSON.parse(text);

        return {
            decision: ErrorDecision[parsed.decision as keyof typeof ErrorDecision] || ErrorDecision.SKIP,
            user_message: parsed.user_message || "Analizando el error...",
            reason: parsed.reason,
        };
    } catch {
        // Si el propio LLM falla, defaultear a SKIP
        return {
            decision: ErrorDecision.SKIP,
            user_message: "No pude analizar el error, continuando con el siguiente paso.",
        };
    }
}

/**
 * Analiza un error y decide la acción de recuperación.
 *  - Primero intenta match rápido con patrones regex.
 *  - Si no hay match y queda en intento 2+, consulta al LLM.
 */
export async function analyzeError(
    step: any,
    errorMsg: string,
    attempt: number = 1,
    goal: string = ""
): Promise<ErrorAnalysis> {
    // Fast path: patrones conocidos
    for (const { pattern, decision, message } of KNOWN_ERRORS) {
        if (pattern.test(errorMsg)) {
            if (decision === ErrorDecision.RETRY && attempt >= 3) {
                return { decision: ErrorDecision.SKIP, user_message: "No pude completar ese paso, continuando..." };
            }
            return { decision, user_message: message };
        }
    }

    // Si ya llevamos 3+ intentos sin match → LLM decide si replannear o abortar
    if (attempt >= 3) {
        return analyzeErrorWithLLM(
            step.tool || "unknown",
            errorMsg,
            step.description || "",
            goal
        );
    }

    // 1er y 2do intento sin match → LLM analiza desde el segundo intento
    if (attempt >= 2) {
        return analyzeErrorWithLLM(
            step.tool || "unknown",
            errorMsg,
            step.description || "",
            goal
        );
    }

    // 1er intento sin match → reintentar
    return {
        decision: ErrorDecision.RETRY,
        user_message: "Ocurrió un error inesperado, reintentando...",
    };
}

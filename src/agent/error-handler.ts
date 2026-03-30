export enum ErrorDecision {
    RETRY = "RETRY",
    SKIP = "SKIP",
    ABORT = "ABORT",
    FIX = "FIX",
}

interface ErrorAnalysis {
    decision: ErrorDecision;
    user_message?: string;
    reason?: string;
    fix_suggestion?: string;
}

// Patrones de errores conocidos → decisión automática sin llamar al LLM
const KNOWN_ERRORS: Array<{ pattern: RegExp; decision: ErrorDecision; message: string }> = [
    { pattern: /timeout/i,                  decision: ErrorDecision.RETRY, message: "Tomó más tiempo de lo esperado, reintentando..." },
    { pattern: /network|ECONNREFUSED/i,     decision: ErrorDecision.RETRY, message: "Problema de red, reintentando..." },
    { pattern: /ENOENT|not found/i,         decision: ErrorDecision.SKIP,  message: "Archivo no encontrado, continuando con el siguiente paso." },
    { pattern: /permission denied|EPERM/i,  decision: ErrorDecision.ABORT, message: "Sin permisos para completar esa operación." },
    { pattern: /API key|authentication/i,   decision: ErrorDecision.ABORT, message: "Error de autenticación. Verifica tu API key." },
];

export function analyzeError(
    step: any,
    errorMsg: string,
    attempt: number = 1
): ErrorAnalysis {
    // Intentos 1-3: revisar errores conocidos
    for (const { pattern, decision, message } of KNOWN_ERRORS) {
        if (pattern.test(errorMsg)) {
            if (decision === ErrorDecision.RETRY && attempt >= 3) {
                // Demasiados reintentos, saltar paso
                return { decision: ErrorDecision.SKIP, user_message: "No pude completar ese paso, continuando..." };
            }
            return { decision, user_message: message };
        }
    }

    // Si ya llevamos 3 intentos sin match conocido → saltar
    if (attempt >= 3) {
        return {
            decision: ErrorDecision.SKIP,
            user_message: `El paso ${step.step} falló repetidamente, lo omití y continué.`,
            reason: errorMsg,
        };
    }

    // Por defecto en 1er y 2do intento → reintentar
    return {
        decision: ErrorDecision.RETRY,
        user_message: "Ocurrió un error inesperado, reintentando...",
    };
}

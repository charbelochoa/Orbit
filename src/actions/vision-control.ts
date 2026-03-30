/**
 * vision-control.ts
 * TypeScript bridge to the Python OrbitEngine (port 18790).
 * Exposes YOLO detection (orbit_master_v1.pt) as Gemini tool calls.
 *
 * Classes detected: botones (0), campo_texto (1), icono (2)
 */

const ENGINE_URL = "http://localhost:18790";
const TIMEOUT_MS = 15_000;

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function engineFetch(path: string, body?: object): Promise<any> {
    const method = body ? "POST" : "GET";
    const init: RequestInit = {
        method,
        headers: body ? { "Content-Type": "application/json" } : undefined,
        body:    body ? JSON.stringify(body) : undefined,
        signal:  AbortSignal.timeout(TIMEOUT_MS),
    };
    const res = await fetch(`${ENGINE_URL}${path}`, init);
    if (!res.ok) {
        const txt = await res.text();
        throw new Error(`Engine HTTP ${res.status}: ${txt.slice(0, 200)}`);
    }
    return res.json();
}

function formatDetection(d: any): string {
    return `[${d.label}] conf=${(d.confidence * 100).toFixed(1)}%  center=(${d.center[0]},${d.center[1]})`;
}

// ─── Exported tool functions ──────────────────────────────────────────────────

/**
 * vision_detect — capture screen + run YOLO, return detected elements.
 * parameters: { label?: string, conf?: number }
 */
export async function visionDetect(parameters: any): Promise<string> {
    const label = parameters?.label ?? null;
    const conf  = Number(parameters?.conf ?? 0.45);

    console.log(`[Vision Detect] 👁️  label=${label ?? "all"} conf=${conf}`);

    try {
        const result = await engineFetch("/detect", { label, conf });

        if (result.error) return `❌ Vision error: ${result.error}`;

        const dets: any[] = result.detections ?? [];
        if (dets.length === 0) {
            return label
                ? `No encontré ningún elemento '${label}' en pantalla.`
                : `No se detectaron elementos en pantalla (conf > ${conf}).`;
        }

        const lines = dets.map((d: any, i: number) =>
            `  ${i}. ${formatDetection(d)}`
        );
        return [
            `Detectados ${result.total} elemento(s) en pantalla:`,
            ...lines,
            `\nTamaño pantalla: ${result.screen_size?.[0]}×${result.screen_size?.[1]}px`
        ].join("\n");

    } catch (e: any) {
        console.error("[Vision Detect] ❌", e.message);
        if (e.message.includes("ECONNREFUSED") || e.message.includes("fetch")) {
            return "⚠️ El motor de visión Python no está disponible. Asegúrate de que engine/orbit_engine.py esté corriendo (puerto 18790).";
        }
        return `Error en visión: ${e.message}`;
    }
}

/**
 * vision_click — find element by label + click with Bézier mouse movement.
 * parameters: { label: string, instance?: number, conf?: number }
 */
export async function visionClick(parameters: any): Promise<string> {
    const label    = parameters?.label ?? "botones";
    const instance = Number(parameters?.instance ?? 0);
    const conf     = Number(parameters?.conf ?? 0.45);

    console.log(`[Vision Click] 🖱️  label=${label} instance=${instance}`);

    try {
        const result = await engineFetch("/click", { label, instance, conf });

        if (result.error) return `❌ ${result.error}`;

        return result.clicked
            ? `Click realizado en '${result.label}' [${result.instance}] en (${result.center[0]}, ${result.center[1]}) — conf ${(result.confidence * 100).toFixed(1)}%`
            : `No pude hacer click en '${label}'.`;

    } catch (e: any) {
        console.error("[Vision Click] ❌", e.message);
        if (e.message.includes("ECONNREFUSED")) {
            return "⚠️ Motor de visión no disponible (puerto 18790).";
        }
        return `Error en vision_click: ${e.message}`;
    }
}

/**
 * vision_type — detect campo_texto, click it, type with human rhythm.
 * parameters: { text: string, element_label?: string, conf?: number }
 */
export async function visionType(parameters: any): Promise<string> {
    const text  = parameters?.text ?? "";
    const label = parameters?.element_label ?? "campo_texto";
    const conf  = Number(parameters?.conf ?? 0.45);

    if (!text) return "Necesito el texto a escribir.";
    console.log(`[Vision Type] ⌨️  "${text.slice(0, 30)}" → ${label}`);

    try {
        const result = await engineFetch("/type", { text, element_label: label, conf });

        if (result.error) return `❌ ${result.error}`;

        return result.element_found
            ? `Texto "${text.slice(0, 40)}" escrito en '${label}'.`
            : `Texto escrito (no se encontró '${label}' para hacer click primero).`;

    } catch (e: any) {
        console.error("[Vision Type] ❌", e.message);
        if (e.message.includes("ECONNREFUSED")) {
            return "⚠️ Motor de visión no disponible (puerto 18790).";
        }
        return `Error en vision_type: ${e.message}`;
    }
}

/**
 * vision_status — check if Python engine is running and model is loaded.
 */
export async function visionStatus(): Promise<string> {
    try {
        const result = await engineFetch("/status");
        const loaded = result.model_loaded && !result.model_error;
        return [
            `Motor de visión: ${result.status === "online" ? "🟢 Online" : "🔴 Offline"}`,
            `Modelo cargado: ${loaded ? "✅" : "❌"} ${result.model_error ?? ""}`,
            `Ruta: ${result.model_path}`,
            `Archivo existe: ${result.model_exists ? "Sí" : "No — copia orbit_master_v1.pt en engine/models/"}`,
            `Clases: ${(result.classes ?? []).join(", ")}`,
        ].join("\n");
    } catch (e: any) {
        return `⚠️ Motor de visión no disponible en puerto 18790. Inicia engine/orbit_engine.py primero.\nError: ${e.message}`;
    }
}

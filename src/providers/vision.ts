import { getConfig } from "../config/config.js";
import { providerRegistry } from "./registry.js";
import type { ImageAttachment, TextGenerationParams } from "./types.js";

export async function analyzeImage(
    image: ImageAttachment,
    params: Omit<TextGenerationParams, "image">,
): Promise<string> {
    const config = getConfig();
    const requested = process.env.ORBIT_VISION_PROVIDER || "gemini";
    if (!Object.hasOwn(config.providers, requested)) throw new Error("ORBIT_VISION_PROVIDER tiene un proveedor desconocido.");
    const id = requested as keyof typeof config.providers;
    const provider = providerRegistry.get(id);
    if (!provider?.isAvailable()) throw new Error("Configura el proveedor de visión " + id + " para analizar la pantalla.");
    if (params.messages.at(-1)?.role !== "user") throw new Error("La imagen requiere una solicitud del usuario.");
    const model = process.env.ORBIT_VISION_MODEL || config.providers[id].models.vision ||
        (id === "gemini" ? "gemini-2.5-flash" : undefined);
    const result = await providerRegistry.generateText({ ...params, model, image }, id);
    return result.text;
}

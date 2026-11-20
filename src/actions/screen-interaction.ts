/**
 * screen-interaction.ts
 * Gemini Vision-powered screen element finding + smart clicking.
 *
 * SPEED OPTIMIZATIONS:
 * - Uses persistent PS bridge (no new process per action)
 * - Uses gemini-2.5-flash-lite (lighter model, faster response)
 * - Simplified "x,y" response format (regex parse, no JSON overhead)
 * - Shared Bezier helpers from ps-bridge
 */

import { desktopPoint, dragPointer, getScreenSize, movePointer } from "./ps-bridge.js";
import { captureDesktopPng, pngDimensions } from "./screenshot.js";
import { analyzeImage } from "../providers/vision.js";

/**
 * Find element coordinates using Gemini Vision.
 * The image may have different pixel dimensions than the logical screen
 * (e.g. 150% DPI scaling → 2880x1620 image on 1920x1080 screen).
 * We ask Gemini to report coords in IMAGE pixel space, then scale to screen space.
 */
async function findElementCoords(
    description: string,
    screenshot: Buffer,
    screenW: number,
    screenH: number,
    signal?: AbortSignal,
): Promise<{ x: number; y: number; found: boolean }> {
    const dimensions = pngDimensions(screenshot);
    const imgW = dimensions.width || screenW;
    const imgH = dimensions.height || screenH;

    const scaleX = screenW / imgW;
    const scaleY = screenH / imgH;

    console.log(`[Screen Find] screen=${screenW}x${screenH} img=${imgW}x${imgH} scale=${scaleX.toFixed(2)},${scaleY.toFixed(2)}`);

    const prompt = `You are a precise UI element locator. The image is a screenshot of a Windows desktop (${imgW}x${imgH} pixels).

TASK: Find the exact pixel coordinates of the CENTER of this element: "${description}"

RULES:
- Look carefully at the ENTIRE screenshot, including the taskbar at the bottom, desktop icons, and all open windows.
- The coordinates must be in the image's pixel space (0,0 is top-left, ${imgW},${imgH} is bottom-right).
- Be precise: identify the element visually and return the center point.
- For desktop icons, the center is in the middle of the icon image (not the text label below it).
- For taskbar icons, the center is in the middle of the icon on the taskbar.
- For buttons/links in windows, the center is the middle of the clickable area.

Return ONLY two numbers separated by a comma: x,y
Example: 450,320
If the element is not visible anywhere on screen, return: 0,0`;

    const descriptionResult = await analyzeImage({ mimeType: "image/png", data: screenshot.toString("base64") }, {
        messages: [{ role: "user", content: prompt }],
        maxTokens: 160,
        signal,
    });
    const text = descriptionResult.trim();
    const match = text.match(/^(\d+)\s*,\s*(\d+)$/);
    if (match) {
        const rawX = parseInt(match[1], 10);
        const rawY = parseInt(match[2], 10);
        if ((rawX || rawY) && rawX < imgW && rawY < imgH) {
            const x = Math.min(screenW - 1, Math.round(rawX * scaleX));
            const y = Math.min(screenH - 1, Math.round(rawY * scaleY));
            console.log(`[Screen Find] raw=(${rawX},${rawY}) -> screen=(${x},${y})`);
            return { x, y, found: true };
        }
    }
    return { x: 0, y: 0, found: false };
}

// Exported Tool Functions

/**
 * screen_find — Find any UI element on screen by visual description.
 * Returns coordinates for subsequent click/interaction.
 */
export async function screenFind(parameters: any, signal?: AbortSignal): Promise<string> {
    const description = (parameters?.description || parameters?.element || "").trim();
    if (!description) return "Necesito una descripcion del elemento a buscar en pantalla.";
    console.log(`[Screen Find] Buscando: "${description}"`);
    try {
        const [screenW, screenH] = await getScreenSize(signal);
        const capture = await captureDesktopPng();
        signal?.throwIfAborted();
        const result = await findElementCoords(description, capture, screenW, screenH, signal);
        if (!result.found) {
            return `No encontre "${description}" en pantalla.`;
        }
        return `Elemento encontrado: "${description}" en (${result.x}, ${result.y}).`;
    } catch (e: any) {
        signal?.throwIfAborted();
        console.error("[Screen Find] ", e);
        return `Error buscando elemento: ${e.message}`;
    }
}

/**
 * click_element — Find a UI element by description and click it.
 * Combines Gemini Vision search + Bezier mouse movement + click.
 */
export async function clickElement(parameters: any, signal?: AbortSignal): Promise<string> {
    const description = (parameters?.description || parameters?.element || "").trim();
    const clickType = (parameters?.click_type || "left").toLowerCase();
    if (!description) return "Necesito una descripcion del elemento a clickear.";
    if (clickType !== "left" && clickType !== "right" && clickType !== "double") return "Error: usa left, right o double.";
    console.log(`[Click Element] Buscando y clickeando: "${description}"`);
    try {
        const [screenW, screenH] = await getScreenSize(signal);
        const capture = await captureDesktopPng();
        signal?.throwIfAborted();
        const result = await findElementCoords(description, capture, screenW, screenH, signal);
        if (!result.found) {
            return `No encontre "${description}" en pantalla.`;
        }
        await movePointer([result.x, result.y], clickType, signal);
        return `Click ${clickType} en "${description}" -> (${result.x}, ${result.y}).`;
    } catch (e: any) {
        signal?.throwIfAborted();
        console.error("[Click Element] ", e);
        return `Error clickeando elemento: ${e.message}`;
    }
}

/**
 * drag — Drag from one point to another (or from current position).
 * Uses Bezier-smoothed movement with mouse held down.
 */
export async function drag(parameters: any, signal?: AbortSignal): Promise<string> {
    try {
        const start = desktopPoint(parameters?.from_x ?? 0, parameters?.from_y ?? 0);
        const target = desktopPoint(parameters?.to_x, parameters?.to_y);
        const origin = await dragPointer(target, start[0] || start[1] ? start : undefined, signal);
        return `Arrastre completado de (${origin.join(", ")}) a (${target.join(", ")}).`;
    } catch (e: any) {
        signal?.throwIfAborted();
        console.error("[Drag] ", e);
        return `Error en drag: ${e.message}`;
    }
}

/**
 * screen_context — Take a screenshot and describe everything visible.
 * Useful for Orbit to understand the current state before taking action.
 */
export async function screenContext(parameters: any, signal?: AbortSignal): Promise<string> {
    const focus = (parameters?.focus || "").trim();
    console.log(`[Screen Context] Capturando contexto...`);
    try {
        const [screenW, screenH] = await getScreenSize(signal);
        const capture = await captureDesktopPng();
        signal?.throwIfAborted();
        const prompt = focus
            ? `Screenshot ${screenW}x${screenH}px. Focus: "${focus}". Describe relevant UI elements, buttons, text fields, positions. Be brief. Respond in Spanish.`
            : `Screenshot ${screenW}x${screenH}px. List ALL visible elements: windows, buttons, text, icons, taskbar. Be brief about positions. Respond in Spanish.`;
        return await analyzeImage({ mimeType: "image/png", data: capture.toString("base64") }, {
            messages: [{ role: "user", content: prompt }],
            maxTokens: 1800,
            signal,
        }) || "No pude describir la pantalla.";
    } catch (e: any) {
        signal?.throwIfAborted();
        console.error("[Screen Context] ", e);
        return `Error capturando contexto: ${e.message}`;
    }
}

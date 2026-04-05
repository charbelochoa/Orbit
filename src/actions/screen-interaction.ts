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

import screenshot from "screenshot-desktop";
import { GoogleGenAI } from "@google/genai";
import dotenv from "dotenv";
import os from "os";
import path from "path";
import fs from "fs/promises";
import { runPS, getCursorPos, getScreenSize, buildBezierScript } from "./ps-bridge.js";

dotenv.config();

/**
 * Returns the DPI scale factor of the primary screen (e.g., 1.5 for 150%).
 * Compares physical screen width (GetSystemMetrics SM_CXSCREEN) with
 * the logical width stored in getScreenSize (rounded to nearest 0.25).
 * Cached after first call.
 */
let _scaleFactor: number | null = null;
export async function getDisplayScaleFactor(): Promise<number> {
    if (_scaleFactor !== null) return _scaleFactor;
    try {
        const [logW] = await getScreenSize();
        const physW = await runPS(
            `Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.Screen]::PrimaryScreen.Bounds.Width`,
            5000
        );
        const physical = parseInt(physW.trim(), 10);
        if (physical > 0 && logW > 0) {
            const raw = physical / logW;
            // Round to nearest quarter-step (1.0, 1.25, 1.5, 1.75, 2.0 …)
            _scaleFactor = Math.round(raw * 4) / 4;
        } else {
            _scaleFactor = 1.0;
        }
    } catch {
        _scaleFactor = 1.0;
    }
    return _scaleFactor;
}

async function captureScreen(): Promise<{ base64: string; path: string }> {
    const tempPath = path.join(os.tmpdir(), `orbit_find_${Date.now()}.png`);
    await screenshot({ filename: tempPath });
    const buf = await fs.readFile(tempPath);
    return { base64: buf.toString("base64"), path: tempPath };
}

/**
 * Read PNG dimensions from the IHDR chunk (bytes 16-23).
 */
function getPngDimensions(buf: Buffer): { w: number; h: number } {
    if (buf[0] === 0x89 && buf[1] === 0x50) {
        const w = buf.readUInt32BE(16);
        const h = buf.readUInt32BE(20);
        return { w, h };
    }
    return { w: 0, h: 0 };
}

/**
 * Find element coordinates using Gemini Vision.
 * The image may have different pixel dimensions than the logical screen
 * (e.g. 150% DPI scaling → 2880x1620 image on 1920x1080 screen).
 * We ask Gemini to report coords in IMAGE pixel space, then scale to screen space.
 */
async function findElementCoords(
    description: string,
    screenshotB64: string,
    screenW: number,
    screenH: number
): Promise<{ x: number; y: number; found: boolean }> {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) throw new Error("GEMINI_API_KEY no configurada");

    const imgBuf = Buffer.from(screenshotB64, "base64");
    const imgDim = getPngDimensions(imgBuf);
    const imgW = imgDim.w || screenW;
    const imgH = imgDim.h || screenH;

    const scaleX = screenW / imgW;
    const scaleY = screenH / imgH;

    console.log(`[Screen Find] screen=${screenW}x${screenH} img=${imgW}x${imgH} scale=${scaleX.toFixed(2)},${scaleY.toFixed(2)}`);

    const ai = new GoogleGenAI({ apiKey });

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

    const response = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: [{
            role: "user",
            parts: [
                { inlineData: { mimeType: "image/png", data: screenshotB64 } },
                { text: prompt }
            ]
        }]
    });

    const text = (response.text || "").trim();
    console.log(`[Screen Find] Gemini response: "${text}"`);
    const match = text.match(/(\d+)\s*,\s*(\d+)/);
    if (match) {
        const rawX = parseInt(match[1], 10);
        const rawY = parseInt(match[2], 10);
        if (rawX > 0 && rawY > 0) {
            const x = Math.round(rawX * scaleX);
            const y = Math.round(rawY * scaleY);
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
export async function screenFind(parameters: any): Promise<string> {
    const description = (parameters?.description || parameters?.element || "").trim();
    if (!description) return "Necesito una descripcion del elemento a buscar en pantalla.";
    console.log(`[Screen Find] Buscando: "${description}"`);
    try {
        const [screenW, screenH] = await getScreenSize();
        const { base64, path: tempPath } = await captureScreen();
        const result = await findElementCoords(description, base64, screenW, screenH);
        try { await fs.unlink(tempPath); } catch {}
        if (!result.found) {
            return `No encontre "${description}" en pantalla.`;
        }
        return `Elemento encontrado: "${description}" en (${result.x}, ${result.y}).`;
    } catch (e: any) {
        console.error("[Screen Find] ", e);
        return `Error buscando elemento: ${e.message}`;
    }
}

/**
 * click_element — Find a UI element by description and click it.
 * Combines Gemini Vision search + Bezier mouse movement + click.
 */
export async function clickElement(parameters: any): Promise<string> {
    const description = (parameters?.description || parameters?.element || "").trim();
    const clickType = (parameters?.click_type || "left").toLowerCase();
    if (!description) return "Necesito una descripcion del elemento a clickear.";
    console.log(`[Click Element] Buscando y clickeando: "${description}"`);
    try {
        const [screenW, screenH] = await getScreenSize();
        const { base64, path: tempPath } = await captureScreen();
        const result = await findElementCoords(description, base64, screenW, screenH);
        try { await fs.unlink(tempPath); } catch {}
        if (!result.found) {
            return `No encontre "${description}" en pantalla.`;
        }
        const tx = Math.max(5, Math.min(result.x, screenW - 5));
        const ty = Math.max(5, Math.min(result.y, screenH - 5));
        const [cx, cy] = await getCursorPos();
        const moveScript = buildBezierScript(cx, cy, tx, ty);
        if (clickType === "double") {
            await runPS(`${moveScript} [OrbitInput]::DblClick()`);
        } else if (clickType === "right") {
            await runPS(`${moveScript} [OrbitInput]::RClick()`);
        } else {
            await runPS(`${moveScript} [OrbitInput]::LClick()`);
        }
        return `Click ${clickType} en "${description}" -> (${tx}, ${ty}).`;
    } catch (e: any) {
        console.error("[Click Element] ", e);
        return `Error clickeando elemento: ${e.message}`;
    }
}

/**
 * drag — Drag from one point to another (or from current position).
 * Uses Bezier-smoothed movement with mouse held down.
 */
export async function drag(parameters: any): Promise<string> {
    const fromX = Math.round(Number(parameters?.from_x) || 0);
    const fromY = Math.round(Number(parameters?.from_y) || 0);
    const toX = Math.round(Number(parameters?.to_x) || 0);
    const toY = Math.round(Number(parameters?.to_y) || 0);
    if (!toX && !toY) return "Necesito coordenadas destino (to_x, to_y).";
    console.log(`[Drag] (${fromX},${fromY}) -> (${toX},${toY})`);
    try {
        let startX = fromX, startY = fromY;
        if (!startX && !startY) {
            [startX, startY] = await getCursorPos();
        }
        const moveToStart = buildBezierScript(...(await getCursorPos()), startX, startY);
        const dragMove = buildBezierScript(startX, startY, toX, toY);
        await runPS(
            `${moveToStart} [OrbitInput]::MouseDown();\nStart-Sleep -Milliseconds 50;\n${dragMove} Start-Sleep -Milliseconds 50;\n[OrbitInput]::MouseUp()`
        );
        return `Drag completado: (${startX},${startY}) -> (${toX},${toY})`;
    } catch (e: any) {
        console.error("[Drag] ", e);
        return `Error en drag: ${e.message}`;
    }
}

/**
 * screen_context — Take a screenshot and describe everything visible.
 * Useful for Orbit to understand the current state before taking action.
 */
export async function screenContext(parameters: any): Promise<string> {
    const focus = (parameters?.focus || "").trim();
    console.log(`[Screen Context] Capturando contexto...`);
    try {
        const [screenW, screenH] = await getScreenSize();
        const { base64, path: tempPath } = await captureScreen();
        const apiKey = process.env.GEMINI_API_KEY;
        if (!apiKey) throw new Error("GEMINI_API_KEY no configurada");
        const ai = new GoogleGenAI({ apiKey });
        const prompt = focus
            ? `Screenshot ${screenW}x${screenH}px. Focus: "${focus}". Describe relevant UI elements, buttons, text fields, positions. Be brief. Respond in Spanish.`
            : `Screenshot ${screenW}x${screenH}px. List ALL visible elements: windows, buttons, text, icons, taskbar. Be brief about positions. Respond in Spanish.`;
        const response = await ai.models.generateContent({
            model: "gemini-2.5-flash-lite",
            contents: [{
                role: "user",
                parts: [
                    { inlineData: { mimeType: "image/png", data: base64 } },
                    { text: prompt }
                ]
            }]
        });
        try { await fs.unlink(tempPath); } catch {}
        return response.text || "No pude describir la pantalla.";
    } catch (e: any) {
        console.error("[Screen Context] ", e);
        return `Error capturando contexto: ${e.message}`;
    }
}

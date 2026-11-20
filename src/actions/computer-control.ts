import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { captureDesktopPng } from "./screenshot.js";
import { desktopPoint, focusDesktopWindow, movePointer, pasteDesktopText, pressDesktopKeys, scrollPointer } from "./ps-bridge.js";

const clickActions = {
    click: "left", left_click: "left", right_click: "right", double_click: "double",
} as const;

const modifiers: Record<string, number> = { ctrl: 17, control: 17, alt: 18, shift: 16, win: 91, windows: 91, meta: 91 };
const keys: Record<string, number> = {
    ...modifiers,
    backspace: 8, tab: 9, enter: 13, return: 13, escape: 27, esc: 27, space: 32,
    pgup: 33, pageup: 33, pgdn: 34, pagedown: 34, end: 35, home: 36,
    left: 37, up: 38, right: 39, down: 40, insert: 45, delete: 46, del: 46,
};
const extendedKeys = new Set([33, 34, 35, 36, 37, 38, 39, 40, 45, 46, 91]);

function keyCode(name: string): number {
    if (/^[a-z0-9]$/.test(name)) return name.toUpperCase().charCodeAt(0);
    if (/^f(?:[1-9]|1\d|2[0-4])$/.test(name)) return 111 + Number(name.slice(1));
    if (Object.hasOwn(keys, name)) return keys[name];
    throw new Error("Orbit no reconoce esa tecla.");
}

export async function computerControl(parameters: any, signal?: AbortSignal): Promise<string> {
    const action = (parameters?.action ?? "").toLowerCase().trim();
    try {
        signal?.throwIfAborted();
        if (Object.hasOwn(clickActions, action)) {
            const button = clickActions[action as keyof typeof clickActions];
            const [x, y] = desktopPoint(parameters.x, parameters.y);
            await movePointer([x, y], button, signal);
            return `Click ${button} en (${x}, ${y}).`;
        }

        switch (action) {
            case "type":
            case "smart_type": {
                const text = parameters.text;
                if (typeof text !== "string" || !text || text.length > 32_000 || text.includes("\0")) {
                    return "Error: indica texto válido de hasta 32 000 caracteres.";
                }
                await pasteDesktopText(text, signal);
                return `Texto enviado al escritorio (${text.length} caracteres).`;
            }
            case "move":
            case "mouse_move": {
                const [x, y] = desktopPoint(parameters.x, parameters.y);
                await movePointer([x, y], undefined, signal);
                return `Cursor movido a (${x}, ${y}).`;
            }
            case "scroll": {
                const direction = (parameters.direction ?? "down").toLowerCase();
                const amount = parameters.amount ?? 3;
                if (!["up", "down", "left", "right"].includes(direction) || !Number.isInteger(amount) || amount < 1 || amount > 100) {
                    return "Error: indica una dirección válida y de 1 a 100 pasos de desplazamiento.";
                }
                const horizontal = direction === "left" || direction === "right";
                await scrollPointer(direction === "down" || direction === "left" ? -amount : amount, horizontal, signal);
                return `Desplazamiento ${direction} de ${amount} pasos.`;
            }
            case "hotkey":
            case "press": {
                const input = action === "hotkey" ? parameters.keys : parameters.key ?? "enter";
                if (typeof input !== "string" || !input.trim() || input.length > 100) return "Error: indica una tecla o combinación válida.";
                const names = input.trim().toLowerCase().split("+").map(name => name.trim());
                if (action === "press" && names.length !== 1) return "Error: usa hotkey para una combinación de teclas.";
                const key = keyCode(names.pop() ?? "");
                const modifierCodes = names.map(name => {
                    if (!Object.hasOwn(modifiers, name)) throw new Error("Modificador de teclado desconocido.");
                    return modifiers[name];
                });
                await pressDesktopKeys([...new Set(modifierCodes)], key, extendedKeys.has(key), signal);
                return `Teclas enviadas: ${input}.`;
            }
            case "screenshot": {
                const target = path.join(os.tmpdir(), `orbit_ss_${randomUUID()}.png`);
                const capture = await captureDesktopPng();
                signal?.throwIfAborted();
                await writeFile(target, capture, { signal });
                return `Captura guardada en: ${target}`;
            }
            case "wait":
            case "sleep": {
                const seconds = parameters.seconds ?? 1;
                if (!Number.isFinite(seconds) || seconds < 0 || seconds > 30) return "Error: indica de 0 a 30 segundos.";
                await delay(seconds * 1000, undefined, { signal });
                return `Esperé ${seconds} segundos.`;
            }
            case "focus_window": {
                const title = parameters.app ?? parameters.description;
                if (typeof title !== "string" || !title.trim() || title.length > 512) return "Error: indica el nombre de la ventana.";
                await focusDesktopWindow(title, signal);
                return `Ventana activada: ${title}`;
            }
            case "screen_find":
            case "screen_click":
                return `La acción ${action} se realiza con las herramientas de visión.`;
            default:
                return `Error: acción de escritorio no reconocida (${action || "vacía"}).`;
        }
    } catch (error) {
        signal?.throwIfAborted();
        return `Error de escritorio (${action}): ${error instanceof Error ? error.message : String(error)}`;
    }
}

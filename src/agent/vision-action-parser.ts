/**
 * VisionActionParser — Parse VLM text output into structured VisualActions.
 *
 * Handles the "Thought: ... Action: action(params)" format produced by the
 * visual system prompt. Robust to minor formatting variations.
 */

import type { VisualAction, VisualActionType } from "./visual-types.js";

const VALID_ACTIONS = new Set<VisualActionType>([
    "click", "double_click", "right_click", "type", "hotkey",
    "scroll", "drag", "move", "wait", "screenshot_and_continue",
    "finished", "call_user",
]);

/**
 * Parse one VLM response into a VisualAction.
 *
 * Expected format:
 *   Thought: <reasoning>
 *   Action: click(x=450, y=320)
 */
export function parseVisualAction(raw: string): VisualAction {
    const thought = extractThought(raw);
    const actionLine = extractActionLine(raw);

    if (!actionLine) {
        // No parseable action — treat as "wait" with the thought preserved
        return { action: "wait", thought: thought || raw.trim() };
    }

    const parsed = parseActionCall(actionLine);
    parsed.thought = thought || undefined;
    return parsed;
}

// ── Internal helpers ─────────────────────────────────────────────────────────

function extractThought(raw: string): string | null {
    // Match "Thought:" at the start of a line, grab everything until "Action:" or end
    const m = raw.match(/Thought:\s*([\s\S]*?)(?=\n\s*Action:|$)/i);
    return m ? m[1].trim() || null : null;
}

function extractActionLine(raw: string): string | null {
    // Match "Action:" at the start of a line, grab the rest of that line
    const m = raw.match(/Action:\s*(.+)/i);
    return m ? m[1].trim() : null;
}

function parseActionCall(line: string): VisualAction {
    // Pattern: actionName(key=value, key=value, ...)
    const m = line.match(/^(\w+)\s*\(([^)]*)\)\s*$/);
    if (!m) {
        // Try bare action name (e.g. "wait()" or just "wait")
        const bare = line.match(/^(\w+)\s*(?:\(\s*\))?\s*$/);
        if (bare && VALID_ACTIONS.has(bare[1] as VisualActionType)) {
            return { action: bare[1] as VisualActionType };
        }
        return { action: "wait", thought: `Unparseable action: ${line}` };
    }

    const actionName = m[1].toLowerCase();
    const rawParams = m[2];

    // Validate action name
    const action: VisualActionType = VALID_ACTIONS.has(actionName as VisualActionType)
        ? (actionName as VisualActionType)
        : "wait";

    if (action === "wait" && actionName !== "wait") {
        return { action: "wait", thought: `Unknown action '${actionName}', waiting instead` };
    }

    // Parse key=value pairs, handling quoted strings
    const params = parseParams(rawParams);

    const result: VisualAction = { action };

    // Map params to typed fields
    if (params.x  !== undefined) result.x  = toInt(params.x);
    if (params.y  !== undefined) result.y  = toInt(params.y);
    if (params.endX   !== undefined) result.endX   = toInt(params.endX);
    if (params.endY   !== undefined) result.endY   = toInt(params.endY);
    if (params.end_x  !== undefined) result.endX   = toInt(params.end_x);
    if (params.end_y  !== undefined) result.endY   = toInt(params.end_y);
    if (params.text   !== undefined) result.text   = params.text;
    if (params.content !== undefined) result.text  = params.content;
    if (params.keys   !== undefined) result.keys   = params.keys;
    if (params.key    !== undefined) result.keys   = params.key;
    if (params.result !== undefined) result.result = params.result;
    if (params.direction !== undefined) {
        const d = params.direction.toLowerCase();
        if (d === "up" || d === "down" || d === "left" || d === "right") {
            result.direction = d;
        }
    }
    if (params.amount !== undefined) result.amount = toInt(params.amount);

    return result;
}

/**
 * Parse "key=value, key=value" supporting quoted strings with commas inside.
 * Examples:
 *   x=450, y=320
 *   text="Hello, World!", x=100
 *   keys="ctrl+s"
 *   result="Done: created 3 files"
 */
function parseParams(raw: string): Record<string, string> {
    const result: Record<string, string> = {};
    if (!raw.trim()) return result;

    // State machine to handle quoted values
    let i = 0;
    const len = raw.length;

    while (i < len) {
        // Skip whitespace and commas
        while (i < len && (raw[i] === " " || raw[i] === "," || raw[i] === "\t")) i++;
        if (i >= len) break;

        // Read key
        const keyStart = i;
        while (i < len && raw[i] !== "=") i++;
        if (i >= len) break;
        const key = raw.substring(keyStart, i).trim();
        i++; // skip '='

        // Skip whitespace after =
        while (i < len && raw[i] === " ") i++;

        // Read value
        let value: string;
        if (i < len && (raw[i] === '"' || raw[i] === "'")) {
            // Quoted value
            const quote = raw[i];
            i++; // skip opening quote
            const valueStart = i;
            while (i < len && raw[i] !== quote) {
                if (raw[i] === "\\" && i + 1 < len) i++; // skip escaped char
                i++;
            }
            value = raw.substring(valueStart, i).replace(/\\(.)/g, "$1");
            if (i < len) i++; // skip closing quote
        } else {
            // Unquoted value — read until comma or end
            const valueStart = i;
            while (i < len && raw[i] !== ",") i++;
            value = raw.substring(valueStart, i).trim();
        }

        if (key) result[key] = value;
    }

    return result;
}

function toInt(s: string): number {
    const n = parseInt(s, 10);
    return isNaN(n) ? 0 : n;
}

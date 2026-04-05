/**
 * /crawl — Fase 6 (Browser Pipeline)
 *
 * Navega a una URL con el navegador real (Puppeteer), extrae el contenido
 * de texto de la página (ejecuta JS, bypass de SPAs) y opcionalmente lo
 * guarda como archivo Markdown.
 *
 * Ventaja sobre web_fetch: ejecuta JavaScript → funciona con React/Vue/SPAs.
 *
 * Sintaxis:
 *   /crawl <URL>
 *   /crawl <URL> save <ruta>
 *   /crawl <URL> guardar <ruta>
 */

import fs   from "fs/promises";
import path from "path";
import os   from "os";
import { browserControl } from "../../actions/browser-control.js";
import type { CommandHandler } from "../types.js";

// ── Security: allowed save roots ─────────────────────────────────────────────
const ALLOWED_ROOTS = [
    path.resolve(process.cwd()),
    path.resolve(os.homedir(), "Desktop"),
    path.resolve(os.homedir(), "Downloads"),
    path.resolve(os.homedir(), "Documents"),
    os.tmpdir(),
];

function validateSavePath(resolved: string): string | null {
    for (const root of ALLOWED_ROOTS) {
        if (resolved === root || resolved.startsWith(root + path.sep)) return null;
    }
    return `Ruta bloqueada: '${resolved}' está fuera de los directorios permitidos.`;
}

export const crawlCommand: CommandHandler = async (ctx) => {
    const raw = ctx.rawText.replace(/^\/crawl\s*/i, "").trim();

    if (!raw) {
        return [
            "Uso: /crawl <URL> [save <ruta>]",
            "",
            "Ejemplos:",
            "  /crawl https://docs.python.org/3/",
            "  /crawl github.com/microsoft/vscode save desktop/vscode-readme.md",
            "",
            "Extrae el texto de páginas con JavaScript (SPAs, React, Vue, etc.)",
        ].join("\n");
    }

    // ── Parse "URL save path" or just "URL" ──────────────────────────────────
    const saveMatch = raw.match(/^(.+?)\s+(?:save|guardar|save to|guardar en)\s+(.+)$/i);
    let rawUrl  = (saveMatch ? saveMatch[1] : raw).trim();
    const savePath = saveMatch ? saveMatch[2].trim() : null;

    // Ensure protocol
    if (!/^https?:\/\//i.test(rawUrl)) rawUrl = `https://${rawUrl}`;

    // Validate URL structure
    try { new URL(rawUrl); } catch {
        return `URL inválida: ${rawUrl}`;
    }

    // Validate save path if provided
    let resolvedSavePath: string | null = null;
    if (savePath) {
        // Expand desktop/documents shortcuts
        let expandedPath = savePath;
        if (/^desktop[/\\]/i.test(savePath)) {
            expandedPath = path.join(os.homedir(), "Desktop", savePath.replace(/^desktop[/\\]/i, ""));
        } else if (/^documents[/\\]/i.test(savePath)) {
            expandedPath = path.join(os.homedir(), "Documents", savePath.replace(/^documents[/\\]/i, ""));
        } else if (/^downloads[/\\]/i.test(savePath)) {
            expandedPath = path.join(os.homedir(), "Downloads", savePath.replace(/^downloads[/\\]/i, ""));
        }
        resolvedSavePath = path.resolve(expandedPath);
        const pathErr = validateSavePath(resolvedSavePath);
        if (pathErr) return pathErr;
    }

    ctx.sendReply({ type: "typing", text: `Crawleando ${rawUrl}…` });

    // ── Navigate ─────────────────────────────────────────────────────────────
    const gotoResult = await browserControl({ action: "go_to", url: rawUrl });
    if (gotoResult.startsWith("URL bloqueada") || gotoResult.startsWith("Fallo")) {
        return gotoResult;
    }
    const title = gotoResult.replace(/^Página cargada:\s*/i, "").trim() || rawUrl;

    // ── Extract text ─────────────────────────────────────────────────────────
    const content = await browserControl({ action: "extract", mode: "text" });

    // ── Save or return ────────────────────────────────────────────────────────
    if (resolvedSavePath) {
        await fs.mkdir(path.dirname(resolvedSavePath), { recursive: true });
        const md = `# ${title}\n\n> Fuente: ${rawUrl}\n> Crawleado: ${new Date().toLocaleString("es-ES")}\n\n---\n\n${content}`;
        await fs.writeFile(resolvedSavePath, md, "utf-8");
        return `Página "${title}" guardada en:\n${resolvedSavePath}\n(${content.length} caracteres)`;
    }

    const preview = content.slice(0, 4000);
    const truncated = content.length > 4000;
    return `**${title}**\n*${rawUrl}*\n\n---\n\n${preview}${truncated ? "\n\n[… contenido truncado a 4000 caracteres]" : ""}`;
};

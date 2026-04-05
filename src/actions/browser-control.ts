import puppeteer, { Browser, Page } from "puppeteer-core";
import fs   from "fs/promises";
import path from "path";
import os   from "os";

// ── Security: URL validation ──────────────────────────────────────────────────
const BLOCKED_PROTOCOLS = new Set(["file:", "javascript:", "data:", "vbscript:"]);

function isUrlSafe(urlStr: string): boolean {
    try {
        const u = new URL(urlStr);
        return !BLOCKED_PROTOCOLS.has(u.protocol);
    } catch {
        return false;
    }
}

// Mantenemos la instancia del navegador abierta durante la sesión
let browser: Browser | null = null;
let currentPage: Page | null = null;

// En Windows usar Edge o Chrome por defecto, evitando descargar binarios pesados if using core
const WIN_CHROME_PATH = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const WIN_EDGE_PATH = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";

async function getBrowser(): Promise<Browser> {
    if (browser && browser.connected) return browser;
    
    // Tratamos de lanzar Chrome, si falla probamos Edge
    try {
        browser = await puppeteer.launch({
            executablePath: WIN_CHROME_PATH,
            headless: false,
            defaultViewport: null,
            args: ['--start-maximized']
        });
    } catch {
        browser = await puppeteer.launch({
            executablePath: WIN_EDGE_PATH,
            headless: false,
            defaultViewport: null,
            args: ['--start-maximized']
        });
    }
    
    return browser;
}

export async function browserControl(parameters: any): Promise<string> {
    const action = parameters?.action?.toLowerCase().trim();
    if (!action) return "Acción requerida (go_to, search, click, type, scroll, get_text, close)";

    console.log(`[Browser] Action: ${action}`, parameters);
    try { const b = await getBrowser();
    const pages = await b.pages();
    currentPage = pages.length > 0 ? pages[pages.length - 1] : await b.newPage();
    //  Timeout safe context currentPage.setDefaultTimeout(10000);
switch (action) { case "go_to": { let url = parameters.url;
    if (!url.startsWith("http")) url = `https://${url}`;
    if (!isUrlSafe(url)) return `URL bloqueada por seguridad: ${url}`;
    await currentPage.goto(url, { waitUntil: 'domcontentloaded' });
    return `Página cargada: ${await currentPage.title()}`; } case "search": { const query = parameters.query;
    await currentPage.goto(`https://www.google.com/search?q=${encodeURIComponent(query)}`);
    return `Búsqueda en Google completada para: ${query}`; } case "click": { const selector = parameters.selector;
    if (!selector) return "Se requiere CSS selector para hacer click.";
    await currentPage.waitForSelector(selector);
    await currentPage.click(selector);
    return `Click realizado en: ${selector}`; } case "type": { const selector = parameters.selector;
    const text = parameters.text;
    if (!selector || !text) return "Se requiere selector y texto para type.";
    await currentPage.waitForSelector(selector);
    await currentPage.type(selector, text, { delay: 50 });
    return `Texto escrito en: ${selector}`; } case "scroll": { const direction = parameters.direction || "down";
    await currentPage.evaluate((dir) => { const scrollAmount = window.innerHeight * 0.8;
    window.scrollBy({ top: dir === 'down' ? scrollAmount : -scrollAmount, behavior: 'smooth' }); }, direction);
    return `Scroll exitoso hacia ${direction}.`; } case "get_text": { const selector = parameters.selector || "body";
    const text = await currentPage.evaluate((sel) => { const el = document.querySelector(sel);
    return el ? (el as HTMLElement).innerText : ""; }, selector);
    return text.length > 3000 ? text.slice(0, 3000) + "\n[TEXTO TRUNCADO]" : (text || "Sin texto encontrado");}
case "close": { if (browser) { await browser.close();
    browser = null;}
return "Navegador cerrado.";}

// ── Fase 6: Browser Pipeline ──────────────────────────────────────────────

case "screenshot": {
    const fullPage = (parameters.full_page ?? false) as boolean;
    const buf = await currentPage.screenshot({ type: "png", fullPage }) as Buffer;
    const tmpPath = path.join(os.tmpdir(), `orbit_screenshot_${Date.now()}.png`);
    await fs.writeFile(tmpPath, buf);
    return `Screenshot capturado: ${tmpPath} (${Math.round(buf.length / 1024)} KB)`;
}

case "wait_for": {
    const timeout = (parameters.timeout_ms ?? 10_000) as number;
    const selector = parameters.selector as string | undefined;
    const urlFrag  = parameters.url   as string | undefined;
    const titleStr = parameters.title as string | undefined;
    if (selector) {
        await currentPage.waitForSelector(selector, { timeout });
        return `Selector '${selector}' encontrado.`;
    }
    if (urlFrag) {
        await currentPage.waitForFunction(
            (expected: string) => window.location.href.includes(expected),
            { timeout },
            urlFrag
        );
        return `URL contiene '${urlFrag}'.`;
    }
    if (titleStr) {
        await currentPage.waitForFunction(
            (expected: string) => document.title.includes(expected),
            { timeout },
            titleStr
        );
        return `Título de página contiene '${titleStr}'.`;
    }
    return "wait_for requiere 'selector', 'url' o 'title'.";
}

case "evaluate": {
    const script = (parameters.script ?? "") as string;
    if (!script) return "Se requiere 'script' para evaluate.";
    // Security: block cookie/credential access
    const BLOCKED_TOKENS = ["document.cookie", ".password", "XMLHttpRequest"];
    if (BLOCKED_TOKENS.some(t => script.toLowerCase().includes(t.toLowerCase()))) {
        return "Script bloqueado: no se permite acceso a cookies, contraseñas o XMLHttpRequest.";
    }
    // Evaluate expression in page context (read-only DOM queries)
    const rawResult = await currentPage.evaluate(
        (s: string) => { return (new Function(`return (${s})`))(); },
        script
    );
    const str = rawResult === null || rawResult === undefined
        ? "null"
        : typeof rawResult === "object"
            ? JSON.stringify(rawResult, null, 2)
            : String(rawResult);
    return str.slice(0, 3000);
}

case "extract": {
    const mode = (parameters.mode ?? "text") as string;
    switch (mode) {
        case "text": {
            const text = await currentPage.evaluate(
                () => (document.body as HTMLElement)?.innerText ?? ""
            );
            return text.slice(0, 6000) + (text.length > 6000 ? "\n[TRUNCADO]" : "");
        }
        case "links": {
            const links = await currentPage.evaluate(() =>
                Array.from(document.querySelectorAll("a[href]")).slice(0, 100).map((a: any) => ({
                    text: (a.innerText ?? "").trim().slice(0, 80),
                    href: a.href as string,
                }))
            );
            const md = (links as Array<{text: string; href: string}>)
                .map(l => `- [${l.text || l.href}](${l.href})`)
                .join("\n");
            return md.slice(0, 4000) || "No se encontraron enlaces.";
        }
        case "table": {
            const tables = await currentPage.evaluate(() =>
                Array.from(document.querySelectorAll("table")).map(tbl =>
                    Array.from(tbl.querySelectorAll("tr")).map(tr =>
                        Array.from(tr.querySelectorAll("td,th")).map((td: any) => td.innerText.trim())
                    )
                )
            );
            if (!(tables as string[][][]).length) return "No se encontraron tablas en la página.";
            const md = (tables as string[][][]).slice(0, 5).map((rows, ti) => {
                if (!rows.length) return "";
                const header  = rows[0].map(h => h || " ");
                const divider = header.map(() => "---");
                const body    = rows.slice(1)
                    .map(r => "| " + r.map(c => c || " ").join(" | ") + " |")
                    .join("\n");
                return `### Tabla ${ti + 1}\n| ${header.join(" | ")} |\n| ${divider.join(" | ")} |\n${body}`;
            }).join("\n\n");
            return md.slice(0, 6000);
        }
        case "images": {
            const imgs = await currentPage.evaluate(() =>
                Array.from(document.querySelectorAll("img[src]")).slice(0, 50).map((img: any) => ({
                    alt: (img.alt as string) || "",
                    src: img.src as string,
                }))
            );
            const md = (imgs as Array<{alt: string; src: string}>)
                .map(img => `![${img.alt}](${img.src})`)
                .join("\n");
            return md.slice(0, 3000) || "No se encontraron imágenes.";
        }
        default:
            return `Modo '${mode}' no soportado. Usa: text | links | table | images`;
    }
}

case "fill_form": {
    const fields = parameters.fields as Record<string, string> | undefined;
    if (!fields || typeof fields !== "object") {
        return "Se requiere 'fields' (objeto: { 'selector': 'valor' }).";
    }
    let filled = 0;
    const total = Object.keys(fields).length;
    for (const [sel, val] of Object.entries(fields)) {
        try {
            await currentPage.waitForSelector(sel, { timeout: 5_000 });
            await currentPage.click(sel, { clickCount: 3 });
            await currentPage.type(sel, String(val), { delay: 30 });
            filled++;
        } catch (e: any) {
            console.warn(`[Browser] fill_form: selector '${sel}' no encontrado: ${e.message}`);
        }
    }
    return `Formulario rellenado: ${filled}/${total} campos.`;
}

case "pdf": {
    const rawOut = (parameters.path ?? "") as string;
    const outPath = rawOut
        ? path.resolve(rawOut)
        : path.join(os.tmpdir(), `orbit_page_${Date.now()}.pdf`);
    await currentPage.pdf({ path: outPath as any, format: "A4", printBackground: true });
    return `PDF guardado: ${outPath}`;
}

case "new_tab": {
    const newPage = await b.newPage();
    if (parameters.url) {
        let tabUrl = parameters.url as string;
        if (!tabUrl.startsWith("http")) tabUrl = `https://${tabUrl}`;
        if (!isUrlSafe(tabUrl)) return `URL bloqueada por seguridad: ${tabUrl}`;
        await newPage.goto(tabUrl, { waitUntil: "domcontentloaded" });
    }
    currentPage = newPage;
    return `Nueva pestaña abierta${parameters.url ? ": " + parameters.url : ""}.`;
}

default: return `Browser action desconocida: ${action}`;} }catch (e: any) { console.error(`[Browser] Error:`, e);
    return `Fallo en el navegador: ${e.message}`;
    }
}

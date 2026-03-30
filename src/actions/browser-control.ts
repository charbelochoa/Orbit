import puppeteer, { Browser, Page } from "puppeteer-core";
import os from "os";

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

    console.log(`[Browser] 🌐 Action: ${action}`, parameters);

    try {
        const b = await getBrowser();
        const pages = await b.pages();
        currentPage = pages.length > 0 ? pages[pages.length - 1] : await b.newPage();
        
        // Timeout safe context
        currentPage.setDefaultTimeout(10000);

        switch (action) {
            case "go_to": {
                let url = parameters.url;
                if (!url.startsWith("http")) url = `https://${url}`;
                await currentPage.goto(url, { waitUntil: 'domcontentloaded' });
                return `Página cargada: ${await currentPage.title()}`;
            }

            case "search": {
                const query = parameters.query;
                await currentPage.goto(`https://www.google.com/search?q=${encodeURIComponent(query)}`);
                return `Búsqueda en Google completada para: ${query}`;
            }

            case "click": {
                const selector = parameters.selector;
                if (!selector) return "Se requiere CSS selector para hacer click.";
                await currentPage.waitForSelector(selector);
                await currentPage.click(selector);
                return `Click realizado en: ${selector}`;
            }

            case "type": {
                const selector = parameters.selector;
                const text = parameters.text;
                if (!selector || !text) return "Se requiere selector y texto para type.";
                await currentPage.waitForSelector(selector);
                await currentPage.type(selector, text, { delay: 50 });
                return `Texto escrito en: ${selector}`;
            }

            case "scroll": {
                const direction = parameters.direction || "down";
                await currentPage.evaluate((dir) => {
                    const scrollAmount = window.innerHeight * 0.8;
                    window.scrollBy({ top: dir === 'down' ? scrollAmount : -scrollAmount, behavior: 'smooth' });
                }, direction);
                return `Scroll exitoso hacia ${direction}.`;
            }

            case "get_text": {
                const selector = parameters.selector || "body";
                const text = await currentPage.evaluate((sel) => {
                    const el = document.querySelector(sel);
                    return el ? (el as HTMLElement).innerText : "";
                }, selector);
                
                return text.length > 3000 ? text.slice(0, 3000) + "\n[TEXTO TRUNCADO]" : (text || "Sin texto encontrado");
            }

            case "close": {
                if (browser) {
                    await browser.close();
                    browser = null;
                }
                return "Navegador cerrado.";
            }

            default: return `Browser action desconocida: ${action}`;
        }
    } catch (e: any) {
         console.error(`[Browser] ❌ Error:`, e);
         return `Fallo en el navegador: ${e.message}`;
    }
}

import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { PROJECT_ROOT } from "../config/paths.js";
import { getSessionToken } from "../gateway/server.js";
import { ORBIT_MASCOT } from "../core/mascot.js";

const WEB_DIR = path.join(PROJECT_ROOT, "src", "ui", "web");
const TYPES: Record<string, string> = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".png": "image/png",
    ".ico": "image/x-icon",
    ".woff2": "font/woff2",
};

export async function startWebServer(port: number, gatewayPort: number) {
    const allowedHosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`]);
    const headers = {
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
        "X-Frame-Options": "DENY",
        "Referrer-Policy": "no-referrer",
        "Permissions-Policy": "camera=(), microphone=(self), geolocation=()",
        "Content-Security-Policy": [
            "default-src 'self'",
            "script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net",
            "style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net",
            "img-src 'self' data: blob:",
            `connect-src 'self' ws://127.0.0.1:${gatewayPort}`,
            "frame-ancestors 'none'",
        ].join("; "),
    };

    const server = createServer(async (req, res) => {
        if (!req.headers.host || !allowedHosts.has(req.headers.host)) {
            res.writeHead(403, headers).end();
            return;
        }
        const pathname = (req.url || "/").split("?")[0];
        if (pathname === "/health") {
            res.writeHead(200, { ...headers, "Content-Type": "application/json" });
            res.end(JSON.stringify({ service: "orbit", status: "ok" }));
            return;
        }
        const filePath = path.resolve(WEB_DIR, pathname === "/" ? "index.html" : "." + pathname);
        const type = TYPES[path.extname(filePath)];
        if (!filePath.startsWith(WEB_DIR + path.sep) || !type) {
            res.writeHead(404, headers).end();
            return;
        }
        try {
            let data: string | Buffer = await readFile(filePath);
            if (path.basename(filePath) === "index.html") {
                data = data.toString("utf-8")
                    .replace("__ORBIT_SESSION_TOKEN__", getSessionToken())
                    .replace("__ORBIT_GATEWAY_PORT__", String(gatewayPort))
                    .replace("__ORBIT_MASCOT__", () => ORBIT_MASCOT.replaceAll("&", "&amp;").replaceAll("<", "&lt;"));
            }
            res.writeHead(200, { ...headers, "Content-Type": type }).end(data);
        } catch {
            if (!res.headersSent) res.writeHead(404, headers).end();
        }
    });
    await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(port, "127.0.0.1", resolve);
    });
    console.log(`[Orbit] Interfaz disponible en http://127.0.0.1:${port}`);
    return server;
}

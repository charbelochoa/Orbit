import { createServer } from "http";
import { readFile }     from "fs/promises";
import path             from "path";
import { fileURLToPath } from "url";
import { getSessionToken } from "../gateway/server.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// In development (tsx): __dirname = src/ui   → web/ is at src/ui/web
// In production (dist): __dirname = dist/ui  → web/ is at src/ui/web (2 levels up + src/ui/web)
// We resolve relative to project root in both cases:
const PROJECT_ROOT = path.resolve(__dirname, "../../");
const WEB_DIR      = path.join(PROJECT_ROOT, "src", "ui", "web");

const MIME_TYPES: Record<string, string> = {
    ".html": "text/html; charset=utf-8",
    ".js":   "application/javascript",
    ".css":  "text/css",
    ".png":  "image/png",
    ".ico":  "image/x-icon",
    ".svg":  "image/svg+xml",
    ".json": "application/json",
};

// ── Security headers ─────────────────────────────────────────────────────────
const SECURITY_HEADERS: Record<string, string> = {
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options":       "DENY",
    "X-XSS-Protection":      "1; mode=block",
    "Referrer-Policy":       "strict-origin-when-cross-origin",
    "Content-Security-Policy": "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self' ws://localhost:18789 ws://127.0.0.1:18789; font-src 'self'; frame-ancestors 'none';",
    "Permissions-Policy":    "camera=(), microphone=(), geolocation=()",
};

export async function startWebServer(port = 3000) {
    const server = createServer(async (req, res) => {
        let urlPath = req.url?.split("?")[0] || "/";

        // Health check endpoint
        if (urlPath === "/health") {
            res.writeHead(200, { "Content-Type": "application/json", ...SECURITY_HEADERS });
            res.end(JSON.stringify({ status: "ok", uptime: process.uptime(), timestamp: new Date().toISOString() }));
            return;
        }

        if (urlPath === "/" || urlPath === "") urlPath = "/index.html";

        const filePath = path.join(WEB_DIR, urlPath);

        // Prevent path traversal
        if (!filePath.startsWith(WEB_DIR)) {
            res.writeHead(403);
            res.end("Forbidden");
            return;
        }

        const ext  = path.extname(filePath).toLowerCase();
        const mime = MIME_TYPES[ext] || "text/plain";

        try {
            let data = await readFile(filePath);
            // Inject session token into index.html so the Web UI can authenticate
            if (urlPath === "/index.html") {
                data = Buffer.from(
                    data.toString("utf-8").replace("__ORBIT_SESSION_TOKEN__", getSessionToken()),
                );
            }
            res.writeHead(200, {
                "Content-Type": mime,
                "Cache-Control": "no-store",
                ...SECURITY_HEADERS,
            });
            res.end(data);
        } catch {
            // Fallback to index.html for SPA routing
            try {
                const data = await readFile(path.join(WEB_DIR, "index.html"));
                res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", ...SECURITY_HEADERS });
                res.end(data);
            } catch {
                res.writeHead(404, SECURITY_HEADERS);
                res.end("Not found");
            }
        }
    });

    await new Promise<void>((resolve, reject) => {
        server.once("error", (err: NodeJS.ErrnoException) => {
            if (err.code === "EADDRINUSE") {
                const fallback = port + 1;
                console.warn(`[Web UI] Puerto ${port} ocupado — usando ${fallback}`);
                server.listen(fallback, () => {
                    console.log(`[Web UI] Dashboard disponible en http://localhost:${fallback}`);
                    resolve();
                });
            } else {
                reject(err);
            }
        });
        server.listen(port, () => {
            console.log(`[Web UI] Dashboard disponible en http://localhost:${port}`);
            resolve();
        });
    });

    return server;
}

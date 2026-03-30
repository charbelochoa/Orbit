import { createServer } from "http";
import { readFile }     from "fs/promises";
import path             from "path";
import { fileURLToPath } from "url";

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

export function startWebServer(port = 3000) {
    const server = createServer(async (req, res) => {
        let urlPath = req.url?.split("?")[0] || "/";
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
            const data = await readFile(filePath);
            res.writeHead(200, {
                "Content-Type": mime,
                "Cache-Control": "no-store",
            });
            res.end(data);
        } catch {
            // Fallback to index.html for SPA routing
            try {
                const data = await readFile(path.join(WEB_DIR, "index.html"));
                res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
                res.end(data);
            } catch {
                res.writeHead(404);
                res.end("Not found");
            }
        }
    });

    server.listen(port, () => {
        console.log(`[Web UI] 🌐 Dashboard disponible en http://localhost:${port}`);
    });

    return server;
}

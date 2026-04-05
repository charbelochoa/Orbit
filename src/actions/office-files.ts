/**
 * office-files.ts — Fase 5 (OfficeCLI)
 *
 * Lee y crea archivos Office (docx, xlsx, pptx, csv) sin requerir Microsoft
 * Office instalado ni paquetes npm extra.
 *
 * Técnica: OOXML = ZIP con XML interno → usamos .NET ZipFile via PowerShell
 * (disponible en Windows 8.1+ / .NET Framework 4.5+).
 */

import { exec }      from "child_process";
import { promisify } from "util";
import fs            from "fs/promises";
import fsSync        from "fs";
import path          from "path";
import os            from "os";
import { normalizePath }  from "../core/path-utils.js";
import { createLogger }   from "../infra/logger.js";

const execAsync = promisify(exec);
const log       = createLogger("OfficeFiles");

// ── Security: allowed roots (same as file-controller) ────────────────────────
const ALLOWED_ROOTS = [
    path.resolve(process.cwd()),
    path.resolve(os.homedir(), "Desktop"),
    path.resolve(os.homedir(), "Downloads"),
    path.resolve(os.homedir(), "Documents"),
    os.tmpdir(),
];

function validatePath(p: string): string | null {
    const resolved = path.resolve(p);
    for (const root of ALLOWED_ROOTS) {
        if (resolved === root || resolved.startsWith(root + path.sep)) return null;
    }
    return `Acceso bloqueado: '${resolved}' está fuera de los directorios permitidos.`;
}

// ── Helper: run a multi-line PowerShell script via temp .ps1 file ─────────────
async function runPS(script: string, timeoutMs = 45_000): Promise<string> {
    const tmp = path.join(os.tmpdir(), `orbit_office_${Date.now()}_${Math.random().toString(36).slice(2)}.ps1`);
    await fs.writeFile(tmp, script, "utf-8");
    try {
        const { stdout } = await execAsync(
            `powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "${tmp}"`,
            { timeout: timeoutMs, windowsHide: true }
        );
        return (stdout ?? "").trim();
    } finally {
        await fs.unlink(tmp).catch(() => {/* ignore */});
    }
}

// ── Helper: extract ZIP (OOXML) to a temp dir ─────────────────────────────────
async function extractToTemp(zipPath: string): Promise<string> {
    const tmpDir = path.join(os.tmpdir(), `orbit_ooxml_${Date.now()}`);
    const safeSrc = zipPath.replace(/'/g, "''");
    const safeDst = tmpDir.replace(/'/g, "''");
    await runPS(`
Add-Type -AssemblyName System.IO.Compression.FileSystem
[System.IO.Compression.ZipFile]::ExtractToDirectory('${safeSrc}', '${safeDst}')
`.trim());
    return tmpDir;
}

// ── Helper: strip XML tags, decode entities, add newlines on para tags ────────
function stripXml(xml: string): string {
    return xml
        .replace(/<w:p(?:\s[^>]*)?>|<a:p(?:\s[^>]*)?>/g, "\n")  // paragraph → newline
        .replace(/<[^>]+>/g, "")
        .replace(/&amp;/g,  "&")
        .replace(/&lt;/g,   "<")
        .replace(/&gt;/g,   ">")
        .replace(/&apos;/g, "'")
        .replace(/&quot;/g, '"')
        .replace(/\n[ \t]+/g,  "\n")
        .replace(/\n{3,}/g,    "\n\n")
        .trim();
}

// ── Read .docx ────────────────────────────────────────────────────────────────
async function readDocx(filePath: string): Promise<string> {
    const tmpDir = await extractToTemp(filePath);
    try {
        const xmlPath = path.join(tmpDir, "word", "document.xml");
        const xml = await fs.readFile(xmlPath, "utf-8");
        return stripXml(xml) || "(Documento vacío)";
    } finally {
        await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {/* ignore */});
    }
}

// ── Read .pptx ────────────────────────────────────────────────────────────────
async function readPptx(filePath: string): Promise<string> {
    const tmpDir = await extractToTemp(filePath);
    try {
        const slidesDir = path.join(tmpDir, "ppt", "slides");
        let entries: string[] = [];
        try { entries = await fs.readdir(slidesDir); } catch { return "(No se encontraron diapositivas)"; }

        const slideFiles = entries
            .filter(f => /^slide\d+\.xml$/.test(f))
            .sort((a, b) => {
                const na = parseInt(a.match(/\d+/)![0]);
                const nb = parseInt(b.match(/\d+/)![0]);
                return na - nb;
            });

        const parts: string[] = [];
        for (let i = 0; i < slideFiles.length; i++) {
            const xml  = await fs.readFile(path.join(slidesDir, slideFiles[i]), "utf-8");
            const text = stripXml(xml);
            if (text) parts.push(`## Diapositiva ${i + 1}\n${text}`);
        }
        return parts.join("\n\n") || "(Presentación vacía)";
    } finally {
        await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {/* ignore */});
    }
}

// ── Read .xlsx ────────────────────────────────────────────────────────────────
// Parses sharedStrings.xml + sheet1.xml → Markdown table (max 100 rows × 26 cols)
async function readXlsx(filePath: string): Promise<string> {
    const tmpDir = await extractToTemp(filePath);
    try {
        // 1. Shared strings
        const sharedStrings: string[] = [];
        const ssPath = path.join(tmpDir, "xl", "sharedStrings.xml");
        if (fsSync.existsSync(ssPath)) {
            const ssXml = await fs.readFile(ssPath, "utf-8");
            for (const m of ssXml.matchAll(/<t(?:\s[^>]*)?>([^<]*)<\/t>/g)) {
                sharedStrings.push(
                    m[1].replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
                );
            }
        }

        // 2. First sheet XML
        const sheetPath = path.join(tmpDir, "xl", "worksheets", "sheet1.xml");
        if (!fsSync.existsSync(sheetPath)) return "(No se encontró hoja de cálculo)";
        const sheetXml = await fs.readFile(sheetPath, "utf-8");

        // 3. Parse cells: <c r="A1" t="s"><v>0</v></c>
        const cellMap = new Map<string, string>();
        const cellRe  = /<c\s[^>]*r="([A-Z]+\d+)"[^>]*(?:t="([^"]*)")?[^>]*>.*?<v>([^<]*)<\/v>/gs;
        for (const m of sheetXml.matchAll(cellRe)) {
            const ref  = m[1];
            const type = m[2] ?? "";
            const val  = m[3];
            cellMap.set(ref, type === "s" ? (sharedStrings[parseInt(val)] ?? val) : val);
        }

        if (!cellMap.size) return "(Hoja vacía)";

        // 4. Determine dimensions (capped)
        function colToNum(c: string): number {
            return c.split("").reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0);
        }
        function numToCol(n: number): string {
            let s = "";
            while (n > 0) { s = String.fromCharCode(((n - 1) % 26) + 65) + s; n = Math.floor((n - 1) / 26); }
            return s;
        }
        let maxRow = 0, maxCol = 0;
        for (const ref of cellMap.keys()) {
            const m2 = ref.match(/^([A-Z]+)(\d+)$/);
            if (!m2) continue;
            maxRow = Math.max(maxRow, parseInt(m2[2]));
            maxCol = Math.max(maxCol, colToNum(m2[1]));
        }
        maxRow = Math.min(maxRow, 100);
        maxCol = Math.min(maxCol, 26);

        // 5. Build markdown table
        const rows: string[][] = [];
        for (let r = 1; r <= maxRow; r++) {
            const row: string[] = [];
            for (let c = 1; c <= maxCol; c++) {
                row.push(cellMap.get(`${numToCol(c)}${r}`) ?? "");
            }
            rows.push(row);
        }

        const header  = rows[0];
        const divider = header.map(() => "---");
        const lines = [
            "| " + header.join(" | ") + " |",
            "| " + divider.join(" | ") + " |",
            ...rows.slice(1).map(r => "| " + r.join(" | ") + " |"),
        ];
        const truncated = maxRow === 100 || maxCol === 26;
        return lines.join("\n") + (truncated ? "\n*(resultado truncado a 100 filas / 26 columnas)*" : "");
    } finally {
        await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {/* ignore */});
    }
}

// ── Read .csv ─────────────────────────────────────────────────────────────────
async function readCsv(filePath: string): Promise<string> {
    const raw = await fs.readFile(filePath, "utf-8");
    const lines  = raw.trim().split(/\r?\n/).slice(0, 100);
    if (!lines.length) return "(CSV vacío)";

    const parsed = lines.map(l =>
        l.split(",").map(c => c.trim().replace(/^"|"$/g, ""))
    );
    const widths = parsed[0].map((_, ci) =>
        Math.max(...parsed.map(r => (r[ci] ?? "").length))
    );
    const fmt     = (row: string[]) => "| " + row.map((c, i) => (c ?? "").padEnd(widths[i])).join(" | ") + " |";
    const divider = "| " + widths.map(w => "-".repeat(w)).join(" | ") + " |";
    return [fmt(parsed[0]), divider, ...parsed.slice(1).map(fmt)].join("\n");
}

// ══════════════════════════════════════════════════════════════════════════════
// ── Public: read_office ───────────────────────────────────────────────────────
// ══════════════════════════════════════════════════════════════════════════════
export async function readOffice(params: Record<string, any>): Promise<string> {
    const rawPath = (params?.path ?? params?.file ?? "") as string;
    if (!rawPath) return "Parámetro 'path' requerido.";
    const filePath = normalizePath(rawPath);
    const pathErr  = validatePath(filePath);
    if (pathErr) return pathErr;

    const ext = path.extname(filePath).toLowerCase();
    log.info(`readOffice: ${filePath}`);
    try {
        switch (ext) {
            case ".docx": return await readDocx(filePath);
            case ".pptx": return await readPptx(filePath);
            case ".xlsx": return await readXlsx(filePath);
            case ".csv":  return await readCsv(filePath);
            default:
                return `Formato '${ext}' no soportado. Formatos válidos: .docx, .xlsx, .pptx, .csv`;
        }
    } catch (e: any) {
        log.error("readOffice error:", e.message);
        return `Error leyendo ${path.basename(filePath)}: ${e.message}`;
    }
}

// ══════════════════════════════════════════════════════════════════════════════
// ── Minimal OOXML templates for .docx ────────────────────────────────────────
// ══════════════════════════════════════════════════════════════════════════════
const DOCX_CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml"  ContentType="application/xml"/>
  <Override PartName="/word/document.xml"
    ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`;

const DOCX_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1"
    Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument"
    Target="word/document.xml"/>
</Relationships>`;

const DOCX_WORD_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>`;

function esc(s: string): string {
    return s
        .replace(/&/g,  "&amp;")
        .replace(/</g,  "&lt;")
        .replace(/>/g,  "&gt;")
        .replace(/"/g,  "&quot;")
        .replace(/'/g,  "&apos;");
}

function buildDocxXml(content: string): string {
    const paras = content.split(/\r?\n/).map(line =>
        `<w:p><w:r><w:t xml:space="preserve">${esc(line)}</w:t></w:r></w:p>`
    ).join("\n    ");

    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
            xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <w:body>
    ${paras}
  </w:body>
</w:document>`;
}

async function writeDocx(filePath: string, params: Record<string, any>): Promise<string> {
    const content = (params?.content ?? params?.text ?? "") as string;
    if (!content) return "Parámetro 'content' requerido para crear .docx.";

    const tmpDir = path.join(os.tmpdir(), `orbit_docx_out_${Date.now()}`);
    await fs.mkdir(path.join(tmpDir, "_rels"),         { recursive: true });
    await fs.mkdir(path.join(tmpDir, "word", "_rels"), { recursive: true });
    await fs.writeFile(path.join(tmpDir, "[Content_Types].xml"),          DOCX_CONTENT_TYPES, "utf-8");
    await fs.writeFile(path.join(tmpDir, "_rels", ".rels"),               DOCX_RELS,          "utf-8");
    await fs.writeFile(path.join(tmpDir, "word", "_rels", "document.xml.rels"), DOCX_WORD_RELS, "utf-8");
    await fs.writeFile(path.join(tmpDir, "word", "document.xml"),         buildDocxXml(content), "utf-8");

    const safeOut = filePath.replace(/'/g, "''");
    const safeTmp = tmpDir.replace(/'/g, "''");
    await runPS(`
Add-Type -AssemblyName System.IO.Compression.FileSystem
if (Test-Path '${safeOut}') { Remove-Item '${safeOut}' }
[System.IO.Compression.ZipFile]::CreateFromDirectory('${safeTmp}', '${safeOut}', 'Optimal', $false)
`.trim());
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {/* ignore */});
    return `Documento Word creado: ${filePath}`;
}

// ══════════════════════════════════════════════════════════════════════════════
// ── Minimal OOXML templates for .xlsx ────────────────────────────────────────
// ══════════════════════════════════════════════════════════════════════════════
const XLSX_CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml"  ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml"
    ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml"
    ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
</Types>`;

const XLSX_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1"
    Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument"
    Target="xl/workbook.xml"/>
</Relationships>`;

const XLSX_WB_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1"
    Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet"
    Target="worksheets/sheet1.xml"/>
</Relationships>`;

function buildWorkbookXml(sheetName: string): string {
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"
          xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets>
    <sheet name="${esc(sheetName)}" sheetId="1" r:id="rId1"/>
  </sheets>
</workbook>`;
}

function numToCol(n: number): string {
    let s = "";
    while (n > 0) { s = String.fromCharCode(((n - 1) % 26) + 65) + s; n = Math.floor((n - 1) / 26); }
    return s;
}

function buildSheetXml(rows: string[][]): string {
    if (!rows.length) {
        return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetData/>
</worksheet>`;
    }

    const xmlRows = rows.map((row, ri) => {
        const cells = row.map((cell, ci) => {
            const ref = `${numToCol(ci + 1)}${ri + 1}`;
            const val = esc(cell);
            if (/^-?\d+(\.\d+)?$/.test(cell.trim())) {
                return `<c r="${ref}"><v>${val}</v></c>`;
            }
            return `<c r="${ref}" t="inlineStr"><is><t>${val}</t></is></c>`;
        }).join("");
        return `<row r="${ri + 1}">${cells}</row>`;
    }).join("\n    ");

    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetData>
    ${xmlRows}
  </sheetData>
</worksheet>`;
}

async function writeXlsx(filePath: string, params: Record<string, any>): Promise<string> {
    let rows: string[][] = params?.rows ?? params?.data ?? [];
    if (!rows.length && params?.csv) {
        rows = (params.csv as string).trim().split(/\r?\n/).map((l: string) =>
            l.split(",").map((c: string) => c.trim())
        );
    }
    if (!rows.length) return "Parámetro 'rows' (array 2D) o 'csv' requerido para crear .xlsx.";

    const sheetName = (params?.sheet ?? params?.sheetName ?? "Hoja1") as string;
    const tmpDir    = path.join(os.tmpdir(), `orbit_xlsx_out_${Date.now()}`);
    await fs.mkdir(path.join(tmpDir, "_rels"),                { recursive: true });
    await fs.mkdir(path.join(tmpDir, "xl", "_rels"),          { recursive: true });
    await fs.mkdir(path.join(tmpDir, "xl", "worksheets"),     { recursive: true });

    await fs.writeFile(path.join(tmpDir, "[Content_Types].xml"),          XLSX_CONTENT_TYPES,       "utf-8");
    await fs.writeFile(path.join(tmpDir, "_rels", ".rels"),               XLSX_RELS,                "utf-8");
    await fs.writeFile(path.join(tmpDir, "xl", "workbook.xml"),           buildWorkbookXml(sheetName), "utf-8");
    await fs.writeFile(path.join(tmpDir, "xl", "_rels", "workbook.xml.rels"), XLSX_WB_RELS,         "utf-8");
    await fs.writeFile(path.join(tmpDir, "xl", "worksheets", "sheet1.xml"),   buildSheetXml(rows),  "utf-8");

    const safeOut = filePath.replace(/'/g, "''");
    const safeTmp = tmpDir.replace(/'/g, "''");
    await runPS(`
Add-Type -AssemblyName System.IO.Compression.FileSystem
if (Test-Path '${safeOut}') { Remove-Item '${safeOut}' }
[System.IO.Compression.ZipFile]::CreateFromDirectory('${safeTmp}', '${safeOut}', 'Optimal', $false)
`.trim());
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {/* ignore */});
    return `Hoja de cálculo Excel creada: ${filePath} (${rows.length} filas, hoja: ${sheetName})`;
}

async function writeCsv(filePath: string, params: Record<string, any>): Promise<string> {
    let rows: string[][] = params?.rows ?? params?.data ?? [];
    if (!rows.length && params?.csv) {
        rows = (params.csv as string).trim().split(/\r?\n/).map((l: string) => l.split(","));
    }
    if (!rows.length && params?.content) {
        await fs.writeFile(filePath, params.content as string, "utf-8");
        return `CSV escrito: ${filePath}`;
    }
    if (!rows.length) return "Parámetro 'rows' o 'csv' requerido.";
    const csv = rows.map(r =>
        r.map(c => /[,"\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c).join(",")
    ).join("\n");
    await fs.writeFile(filePath, csv, "utf-8");
    return `CSV escrito: ${filePath} (${rows.length} filas)`;
}

// ══════════════════════════════════════════════════════════════════════════════
// ── Public: write_office ──────────────────────────────────────────────────────
// ══════════════════════════════════════════════════════════════════════════════
export async function writeOffice(params: Record<string, any>): Promise<string> {
    const rawPath = (params?.path ?? params?.file ?? "") as string;
    if (!rawPath) return "Parámetro 'path' requerido.";
    const filePath = normalizePath(rawPath);
    const pathErr  = validatePath(filePath);
    if (pathErr) return pathErr;

    const ext = path.extname(filePath).toLowerCase();
    log.info(`writeOffice: ${filePath}`);
    try {
        switch (ext) {
            case ".docx": return await writeDocx(filePath, params);
            case ".xlsx": return await writeXlsx(filePath, params);
            case ".csv":  return await writeCsv(filePath, params);
            default:
                return `Formato '${ext}' no soportado para escritura. Soportados: .docx, .xlsx, .csv`;
        }
    } catch (e: any) {
        log.error("writeOffice error:", e.message);
        return `Error escribiendo ${path.basename(filePath)}: ${e.message}`;
    }
}

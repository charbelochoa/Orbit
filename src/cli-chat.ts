#!/usr/bin/env node
/**
 * Orbit CLI — Interactive Terminal Chat
 * Inspired by Claude Code's terminal interface.
 *
 * Usage:
 *   orbit chat                   → Start interactive chat
 *   orbit chat --model gemini    → Use specific provider
 *   orbit chat --no-logo         → Skip welcome banner
 *   orbit chat --compact         → Condensed logo
 */

import { createInterface, Interface } from "readline";
import { WebSocket } from "ws";
import path from "path";
import { fileURLToPath } from "url";
import { runHooks, initHooks } from "./hooks/runner.js";
import { getQueue } from "./agent/task-queue.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ─── ANSI helpers (no deps) ─────────────────────────────────────────────────
const ESC = "\x1B[";
const RESET     = `${ESC}0m`;
const BOLD      = `${ESC}1m`;
const DIM       = `${ESC}2m`;
const ITALIC    = `${ESC}3m`;
const UNDERLINE = `${ESC}4m`;

// 256-color
function fg256(n: number) { return `${ESC}38;5;${n}m`; }
function bg256(n: number) { return `${ESC}48;5;${n}m`; }

// Truecolor (24-bit)
function fgRGB(r: number, g: number, b: number) { return `${ESC}38;2;${r};${g};${b}m`; }
function bgRGB(r: number, g: number, b: number) { return `${ESC}48;2;${r};${g};${b}m`; }

// Orbit palette
const C = {
  accent:    fgRGB(139, 92, 246),  // #8b5cf6
  accentBg:  bgRGB(139, 92, 246),
  bodyFg:    fgRGB(124, 106, 247), // #7c6af7  (like clawd_body)
  bodyBg:    bgRGB(74, 61, 143),   // #4a3d8f  (like clawd_background)
  dim:       fgRGB(113, 113, 122), // #71717a
  dimmer:    fgRGB(82, 82, 91),    // #52525b
  text:      fgRGB(250, 250, 250), // #fafafa
  text2:     fgRGB(161, 161, 170), // #a1a1aa
  success:   fgRGB(34, 197, 94),   // #22c55e
  error:     fgRGB(239, 68, 68),   // #ef4444
  warning:   fgRGB(245, 158, 11),  // #f59e0b
  user:      fgRGB(196, 185, 251), // #c4b9fb
  userBg:    bgRGB(30, 27, 75),    // #1e1b4b
  toolBg:    bgRGB(24, 24, 27),    // #18181b
};

// ─── Pixel‑art mascot (box-drawing chars) ───────────────────────────────────
// ─── "Orbit" Banner ─────────────────────────────────────────────────────────
// Hardcoded letter shapes + computed 3D shadow (offset +1 right, +1 down).
// Face: gradient purple, Shadow: deep dark purple behind.
// One color-switch per segment boundary — no bgRGB, no per-pixel double-char.

const ORBIT_FACE = [
  fgRGB(225, 200, 255),   // row 0 — highlight
  fgRGB(195, 158, 252),   // row 1
  fgRGB(172, 128, 250),   // row 2
  fgRGB(150, 102, 242),   // row 3
  fgRGB(132, 82, 230),    // row 4 — base
];
const ORBIT_SHADOW = fgRGB(55, 20, 110);   // deep purple 3D extrusion

//  O      R      B      I      T
const ORBIT_ROWS = [
  " ████  ████  ████  ██████ ██████",
  "██  ██ ██ ██ ██ ██   ██     ██  ",
  "██  ██ ████  ████    ██     ██  ",
  "██  ██ ██ █  ██ ██   ██     ██  ",
  " ████  ██ ██ ████  ██████   ██  ",
];

function renderOrbitBanner(): string[] {
  const SDX = 1;             // shadow offset cols
  const SDY = 1;             // shadow offset rows
  const faceH = ORBIT_ROWS.length;
  const faceW = ORBIT_ROWS[0].length;
  const outH  = faceH + SDY;
  const outW  = faceW + SDX;

  // Helper: is this coordinate a filled face pixel?
  const isFace = (r: number, c: number) =>
    r >= 0 && r < faceH && c >= 0 && c < faceW && ORBIT_ROWS[r][c] === "█";

  const out: string[] = [];
  for (let r = 0; r < outH; r++) {
    let line = "";
    let lastType = ""; // track current color to batch identical segments
    for (let c = 0; c < outW; c++) {
      const face   = isFace(r, c);
      const shadow = !face && isFace(r - SDY, c - SDX);

      if (face) {
        if (lastType !== "face" + r) {
          if (lastType) line += RESET;
          line += ORBIT_FACE[r];
          lastType = "face" + r;
        }
        line += "█";
      } else if (shadow) {
        if (lastType !== "shadow") {
          if (lastType) line += RESET;
          line += ORBIT_SHADOW;
          lastType = "shadow";
        }
        line += "█";
      } else {
        if (lastType) { line += RESET; lastType = ""; }
        line += " ";
      }
    }
    if (lastType) line += RESET;
    out.push(line);
  }
  return out;
}

// ─── Logo / Banner ──────────────────────────────────────────────────────────

function getVersion(): string {
  try {
    const pkg = require(path.join(__dirname, "../package.json"));
    return pkg.version || "1.0.0";
  } catch { return "1.0.0"; }
}

function renderFullLogo(model: string, cwd: string): string {
  const banner = renderOrbitBanner();
  const ver = getVersion();
  const lines: string[] = [];
  lines.push("");
  // ASCII art banner
  for (const row of banner) {
    lines.push(`    ${row}`);
  }
  lines.push("");
  // Info line below the banner
  const truncCwd = cwd.length > 60 ? "…" + cwd.slice(-59) : cwd;
  lines.push(`    ${C.dim}v${ver}${RESET}  ${C.dimmer}·${RESET}  ${C.dim}${model}${RESET}  ${C.dimmer}·${RESET}  ${C.dim}${truncCwd}${RESET}`);
  lines.push("");
  return lines.join("\n");
}

function renderCondensedLogo(model: string): string {
  const ver = getVersion();
  return `  ${ORBIT_FACE[2]}██${RESET} ${BOLD}${ORBIT_FACE[0]}ORBIT${RESET} ${C.dim}v${ver}${RESET} ${C.dimmer}· ${model}${RESET}\n`;
}

// ─── Spinner ────────────────────────────────────────────────────────────────

const SPINNER_CHARS = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const SPINNER_FRAMES = [...SPINNER_CHARS, ...[...SPINNER_CHARS].reverse()];

class Spinner {
  private frame = 0;
  private interval: ReturnType<typeof setInterval> | null = null;
  private label = "";

  start(label: string) {
    this.label = label;
    this.frame = 0;
    this.interval = setInterval(() => {
      const char = SPINNER_FRAMES[this.frame % SPINNER_FRAMES.length];
      process.stdout.write(`\r${C.accent}${char}${RESET} ${C.dim}${this.label}${RESET}${ESC}K`);
      this.frame++;
    }, 80);
  }

  update(label: string) { this.label = label; }

  stop() {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
    process.stdout.write(`\r${ESC}K`);
  }
}

// ─── Markdown‑lite for terminal ─────────────────────────────────────────────

function renderTerminalMarkdown(text: string): string {
  let out = text;

  // Code blocks: ```lang\n...\n```
  out = out.replace(/```(\w*)\n([\s\S]*?)```/g, (_m, lang, code) => {
    const header = lang ? `${C.dimmer}─── ${lang} ${"─".repeat(Math.max(0, 40 - lang.length))}${RESET}\n` : "";
    const border = `${C.dimmer}${"─".repeat(44)}${RESET}`;
    return `\n${header}${C.text2}${code.trimEnd()}${RESET}\n${border}\n`;
  });

  // Inline code: `code`
  out = out.replace(/`([^`]+)`/g, `${fgRGB(167, 139, 250)}$1${RESET}`);

  // Bold: **text**
  out = out.replace(/\*\*(.+?)\*\*/g, `${BOLD}$1${RESET}`);

  // Italic: *text*
  out = out.replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, `${ITALIC}$1${RESET}`);

  // Headers: # ## ###
  out = out.replace(/^### (.+)$/gm, `${BOLD}${C.accent}   $1${RESET}`);
  out = out.replace(/^## (.+)$/gm,  `${BOLD}${C.accent}  $1${RESET}`);
  out = out.replace(/^# (.+)$/gm,   `${BOLD}${C.accent} $1${RESET}`);

  // Bullet points
  out = out.replace(/^(\s*)[-*] (.+)$/gm, `$1${C.accent}  •${RESET} $2`);

  // Links: [text](url)
  out = out.replace(/\[([^\]]+)\]\(([^)]+)\)/g, `${UNDERLINE}${C.accent}$1${RESET} ${C.dim}($2)${RESET}`);

  return out;
}

// ─── Tool block rendering ───────────────────────────────────────────────────

function renderToolStart(name: string): string {
  return `${C.warning}●${RESET} ${C.text2}${name}${RESET}`;
}

function renderToolEnd(name: string, ok: boolean, duration?: number): string {
  const dot = ok ? `${C.success}●${RESET}` : `${C.error}●${RESET}`;
  const dur = duration ? ` ${C.dimmer}${duration < 1000 ? duration + "ms" : (duration / 1000).toFixed(1) + "s"}${RESET}` : "";
  return `${dot} ${C.text}${name}${RESET}${dur}`;
}

// ─── Slash commands ─────────────────────────────────────────────────────────

const SLASH_COMMANDS: { cmd: string; desc: string }[] = [
  { cmd: "/init",    desc: "Genera ORBIT.md con contexto del proyecto" },
  { cmd: "/task",    desc: "Ejecuta una tarea autónoma" },
  { cmd: "/stop",    desc: "Detiene la generación actual" },
  { cmd: "/clear",   desc: "Limpia el chat" },
  { cmd: "/memory",  desc: "Muestra la memoria" },
  { cmd: "/model",   desc: "Cambia el modelo de IA" },
  { cmd: "/status",  desc: "Estado del sistema" },
  { cmd: "/skills",  desc: "Lista de skills disponibles" },
  { cmd: "/cancel",  desc: "Cancela una tarea activa" },
  { cmd: "/cost",    desc: "Tokens usados y costo de la sesión" },
  { cmd: "/compact", desc: "Resume la conversación para liberar contexto" },
  { cmd: "/diff",    desc: "Muestra git diff del proyecto" },
  { cmd: "/doctor",  desc: "Diagnóstico del sistema" },
  { cmd: "/review",  desc: "Code review del diff actual con IA" },
  { cmd: "/rewind",  desc: "Deshace los últimos N turnos" },
  { cmd: "/todos",   desc: "Gestión de tareas (add/done/rm/clear)" },
  { cmd: "/mcp",      desc: "Gestiona servidores MCP (list/enable/disable)" },
  { cmd: "/insights", desc: "Análisis de sesiones: tareas, herramientas, archivos" },
  { cmd: "/help",     desc: "Muestra esta ayuda" },
  { cmd: "/exit",    desc: "Salir de Orbit" },
];

function showSlashHelp(): string {
  const lines = [`\n${BOLD}${C.accent}Comandos disponibles:${RESET}\n`];
  for (const { cmd, desc } of SLASH_COMMANDS) {
    lines.push(`  ${C.accent}${cmd.padEnd(12)}${RESET} ${C.dim}${desc}${RESET}`);
  }
  lines.push("");
  return lines.join("\n");
}

// ─── Welcome tips ───────────────────────────────────────────────────────────

function renderTips(): string {
  const tips = [
    `${C.accent}💻${RESET} ${C.text2}Escribe código:${RESET}    ${C.dim}"Genera una función TypeScript para..."${RESET}`,
    `${C.accent}🔍${RESET} ${C.text2}Revisar código:${RESET}    ${C.dim}"Revisa este código en busca de bugs"${RESET}`,
    `${C.accent}🌐${RESET} ${C.text2}Buscar en web:${RESET}     ${C.dim}"Busca en internet: ..."${RESET}`,
    `${C.accent}🚀${RESET} ${C.text2}Tarea autónoma:${RESET}    ${C.dim}"/task Automatiza..."${RESET}`,
  ];
  return tips.join("\n") + "\n";
}

// ─── Diff renderer (colored + / - lines) ───────────────────────────────────

function renderDiffBlock(diff: string): string {
  const lines = diff.split("\n");
  return lines.map(line => {
    if (line.startsWith("+++") || line.startsWith("---")) {
      return `${BOLD}${C.dim}${line}${RESET}`;
    }
    if (line.startsWith("@@")) {
      return `${C.accent}${line}${RESET}`;
    }
    if (line.startsWith("+")) {
      return `${fgRGB(34, 197, 94)}${line}${RESET}`;    // green
    }
    if (line.startsWith("-")) {
      return `${fgRGB(239, 68, 68)}${line}${RESET}`;    // red
    }
    return `${C.dim}${line}${RESET}`;
  }).join("\n");
}

// ─── Tab-completion engine ──────────────────────────────────────────────────

function getCompletions(partial: string): string[] {
  if (!partial.startsWith("/")) return [];
  const lower = partial.toLowerCase();
  return SLASH_COMMANDS
    .filter(c => c.cmd.toLowerCase().startsWith(lower))
    .map(c => c.cmd);
}

// ─── Main CLI class ─────────────────────────────────────────────────────────

interface CLIOptions {
  model?: string;
  noLogo?: boolean;
  compact?: boolean;
  wsPort?: number;
}

class OrbitCLI {
  private ws: WebSocket | null = null;
  private rl: Interface | null = null;
  private spinner = new Spinner();
  private model: string;
  private connected = false;
  private streaming = false;
  private streamBuf = "";
  private wsPort: number;
  private compactMode: boolean;
  private noLogo: boolean;
  private toolStartTimes = new Map<string, number>();
  private reconnAttempts = 0;
  private shouldExit = false;
  private sessionStartTime = Date.now();

  // ─── Context / token tracking ────────────────────────────
  private tokensUsed = 0;
  private contextMax = 1_000_000;
  private turnCount = 0;

  // ─── Input history (Ctrl+R) ──────────────────────────────
  private inputHistory: string[] = [];
  private historyIndex = -1;

  // ─── Tab-completion state ────────────────────────────────
  private tabMatches: string[] = [];
  private tabIndex = -1;
  private tabOriginal = "";

  constructor(opts: CLIOptions = {}) {
    this.model = opts.model || "gemini";
    this.wsPort = opts.wsPort || 18789;
    this.compactMode = opts.compact || false;
    this.noLogo = opts.noLogo || false;
  }

  async start() {
    // Print logo
    if (!this.noLogo) {
      if (this.compactMode) {
        process.stdout.write(renderCondensedLogo(this.model));
      } else {
        process.stdout.write(renderFullLogo(this.model, process.cwd()));
        process.stdout.write(renderTips());
        process.stdout.write(`${C.dim}  Escribe ${C.accent}/help${C.dim} para ver comandos · ${C.accent}/exit${C.dim} para salir${RESET}\n\n`);
      }
    }

    // Connect to WebSocket gateway
    this.connect();

    // Setup readline with tab-completion
    this.rl = createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: true,
      prompt: "",
      completer: (line: string) => {
        const hits = getCompletions(line);
        return [hits.length ? hits : SLASH_COMMANDS.map(c => c.cmd), line];
      },
    });

    // Enable keypress events for Ctrl+R history search
    if (process.stdin.isTTY) {
      process.stdin.on("keypress", (_ch: string, key: any) => {
        if (!key) return;
        // Ctrl+R → cycle through history matching current input
        if (key.ctrl && key.name === "r") {
          const current = (this.rl as any).line || "";
          const search = current.toLowerCase();
          // Find next match in history
          const startIdx = this.historyIndex + 1;
          for (let i = startIdx; i < this.inputHistory.length; i++) {
            if (!search || this.inputHistory[i].toLowerCase().includes(search)) {
              this.historyIndex = i;
              // Replace current line
              (this.rl as any).line = this.inputHistory[i];
              (this.rl as any).cursor = this.inputHistory[i].length;
              // Redraw
              process.stdout.write(`\r${ESC}K`);
              this.showPrompt();
              process.stdout.write(this.inputHistory[i]);
              return;
            }
          }
          // Wrap around
          this.historyIndex = -1;
        }

        // Ctrl+T → toggle task panel
        if (key.ctrl && key.name === "t") {
          this.toggleTaskPanel();
        }
      });
    }

    this.showPrompt();

    this.rl.on("line", (line) => this.handleInput(line));
    this.rl.on("close", () => {
      this.cleanup();
      process.exit(0);
    });

    // Graceful shutdown
    process.on("SIGINT", () => {
      if (this.streaming) {
        // First Ctrl+C while streaming = stop
        this.sendWs({ type: "chat", payload: { text: "/stop" } });
        this.spinner.stop();
        this.finishStream();
        process.stdout.write(`\n${C.dim}(generación detenida)${RESET}\n`);
        this.showPrompt();
      } else {
        // Second Ctrl+C = exit
        process.stdout.write(`\n${C.dim}¡Hasta luego!${RESET}\n`);
        this.cleanup();
        process.exit(0);
      }
    });
  }

  // ─── Task Panel (Ctrl+T) ─────────────────────────────────────

  private taskPanelVisible = false;

  private toggleTaskPanel() {
    this.taskPanelVisible = !this.taskPanelVisible;
    if (!this.taskPanelVisible) {
      process.stdout.write(`\n${C.dim}  Panel de tareas cerrado${RESET}\n`);
      this.showPrompt();
      return;
    }

    const tasks = getQueue().listAll();
    const W = 42;
    const line = "─".repeat(W - 2);

    process.stdout.write(`\n  ${C.accent}┌─ Tareas activas ${line.slice(18)}┐${RESET}\n`);

    if (tasks.length === 0) {
      process.stdout.write(`  ${C.accent}│${RESET} ${C.dim}No hay tareas en curso${" ".repeat(W - 25)}${C.accent}│${RESET}\n`);
    } else {
      for (const t of tasks.slice(0, 10)) {
        let icon: string;
        switch (t.status) {
          case "running":   icon = `${C.warning}⠸${RESET}`; break;
          case "done":      icon = `${C.success}✓${RESET}`; break;
          case "failed":    icon = `${C.error}✗${RESET}`; break;
          case "cancelled": icon = `${C.dim}⊘${RESET}`; break;
          default:          icon = `${C.dim}○${RESET}`; break;
        }
        const idShort = t.id.slice(0, 10);
        const goalShort = t.goal.slice(0, W - 18).padEnd(W - 18);
        process.stdout.write(`  ${C.accent}│${RESET} ${icon} ${C.text}${idShort}${RESET}  ${goalShort}${C.accent}│${RESET}\n`);
      }
      if (tasks.length > 10) {
        process.stdout.write(`  ${C.accent}│${RESET} ${C.dim}... y ${tasks.length - 10} más${" ".repeat(W - 16 - String(tasks.length - 10).length)}${C.accent}│${RESET}\n`);
      }
    }

    process.stdout.write(`  ${C.accent}└${"─".repeat(W - 2)}┘${RESET}\n\n`);
    this.showPrompt();
  }

  private showPrompt() {
    const ctxBar = this.renderContextBar();
    const dot = this.connected
      ? `${C.accent}❯${RESET}`
      : `${C.error}❯${RESET}`;
    process.stdout.write(`${ctxBar}${dot} `);
  }

  /** Renders [████░░░░ 42%] context usage bar */
  private renderContextBar(): string {
    if (this.tokensUsed <= 0) return "";
    const pct = Math.min(100, Math.round((this.tokensUsed / this.contextMax) * 100));
    const barW = 8;
    const filled = Math.round(barW * pct / 100);
    const empty = barW - filled;
    // Color shifts from green → yellow → red
    let barColor: string;
    if (pct < 50) barColor = C.success;
    else if (pct < 80) barColor = C.warning;
    else barColor = C.error;

    const bar = `${barColor}${"█".repeat(filled)}${C.dimmer}${"░".repeat(empty)}${RESET}`;
    return `${C.dimmer}[${RESET}${bar}${C.dimmer} ${pct}%]${RESET} `;
  }

  // ─── WebSocket ──────────────────────────────────────────────

  private connect() {
    try {
      this.ws = new WebSocket(`ws://localhost:${this.wsPort}`);
    } catch {
      this.scheduleReconnect();
      return;
    }

    this.ws.on("open", () => {
      this.connected = true;
      this.reconnAttempts = 0;
      this.sessionStartTime = Date.now();
      runHooks("SessionStart", { event: "SessionStart", cwd: process.cwd() }).catch(() => {});
      if (!this.noLogo) {
        // Move back to overwrite prompt, show connected status
        process.stdout.write(`\r${ESC}K${C.success}●${RESET} ${C.dim}Conectado a Orbit Gateway${RESET}\n`);
        this.showPrompt();
      }
      this.sendWs({ type: "status" });
    });

    this.ws.on("close", () => {
      this.connected = false;
      if (!this.shouldExit) {
        process.stdout.write(`\n${C.error}●${RESET} ${C.dim}Desconectado. Reconectando...${RESET}\n`);
        this.scheduleReconnect();
      }
    });

    this.ws.on("error", () => {
      // silently handled by close
    });

    this.ws.on("message", (data) => {
      try {
        const msg = JSON.parse(data.toString());
        this.handleMessage(msg);
      } catch {
        // ignore parse errors
      }
    });
  }

  private scheduleReconnect() {
    if (this.shouldExit) return;
    this.reconnAttempts++;
    const delay = Math.min(30000, 1500 * Math.pow(2, this.reconnAttempts - 1));
    setTimeout(() => this.connect(), delay);
  }

  private sendWs(obj: any) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(obj));
    }
  }

  // ─── Message handler ────────────────────────────────────────

  private handleMessage(msg: any) {
    switch (msg.type) {
      case "orbit_ready":
        break;

      case "orbit_message":
        this.spinner.stop();
        this.finishStream();
        this.estimateTokens(msg.text || "");
        process.stdout.write("\n");
        this.printOrbitMessage(msg.text);
        runHooks("AssistantMessage", { event: "AssistantMessage", cwd: process.cwd(), assistant_message: msg.text || "" }).catch(() => {});
        this.showPrompt();
        break;

      case "orbit_chunk":
        this.spinner.stop();
        if (!this.streaming) {
          this.streaming = true;
          this.streamBuf = "";
          process.stdout.write("\n");
        }
        process.stdout.write(msg.text);
        this.streamBuf += msg.text;
        break;

      case "turn_complete":
        this.finishStream();
        this.spinner.stop();
        this.turnCount++;
        process.stdout.write("\n");
        this.showPrompt();
        break;

      case "tool_call":
        this.spinner.stop();
        this.toolStartTimes.set(msg.tool, Date.now());
        process.stdout.write(`\n  ${renderToolStart(msg.tool)}\n`);
        this.spinner.start(`Ejecutando ${msg.tool}...`);
        break;

      case "tool_result": {
        this.spinner.stop();
        const startT = this.toolStartTimes.get(msg.tool);
        const dur = startT ? Date.now() - startT : undefined;
        this.toolStartTimes.delete(msg.tool);
        process.stdout.write(`  ${renderToolEnd(msg.tool, !msg.error, dur)}\n`);
        // Show brief result preview (with diff highlighting)
        if (msg.result) {
          const preview = typeof msg.result === "string" ? msg.result : JSON.stringify(msg.result);
          if (preview.includes("@@") && (preview.includes("\n+") || preview.includes("\n-"))) {
            process.stdout.write(renderDiffBlock(preview));
          } else {
            const truncated = preview.length > 200 ? preview.slice(0, 200) + "…" : preview;
            process.stdout.write(`  ${C.dim}${truncated.split("\n").join("\n  ")}${RESET}\n`);
          }
        }
        break;
      }

      case "typing":
        if (msg.state === "thinking") {
          this.spinner.start("Pensando...");
        } else if (msg.state === "executing") {
          this.spinner.start(msg.tool ? `Ejecutando: ${msg.tool}` : "Ejecutando...");
        } else {
          this.spinner.stop();
        }
        break;

      case "status":
        if (msg.provider) this.model = msg.provider;
        if (msg.providerId) this.model = msg.providerId;
        if (msg.contextWindow) this.contextMax = msg.contextWindow;
        if (msg.tokensUsed) this.tokensUsed = msg.tokensUsed;
        break;

      case "token_usage":
        if (msg.totalTokens) this.tokensUsed = msg.totalTokens;
        else if (msg.inputTokens || msg.outputTokens) {
          this.tokensUsed = (msg.inputTokens || 0) + (msg.outputTokens || 0);
        }
        if (msg.contextWindow) this.contextMax = msg.contextWindow;
        break;

      case "provider_changed": {
        const name = msg.name || msg.provider || msg.id || "AI";
        this.model = name;
        process.stdout.write(`\n${C.accent}✦${RESET} ${C.text2}Proveedor cambiado a ${BOLD}${name}${RESET}\n`);
        this.showPrompt();
        break;
      }

      case "command_result": {
        this.spinner.stop();
        this.finishStream();
        const cmdText = msg.text || msg.message || "OK";
        // Detect diff content for colorized rendering
        if (cmdText.includes("```diff") || (cmdText.includes("@@") && (cmdText.includes("\n+") || cmdText.includes("\n-")))) {
          // Extract diff blocks and render them
          const diffMatch = cmdText.match(/```diff\n([\s\S]*?)```/);
          if (diffMatch) {
            const before = cmdText.slice(0, cmdText.indexOf("```diff"));
            const after = cmdText.slice(cmdText.indexOf("```", cmdText.indexOf("```diff") + 6) + 3);
            if (before.trim()) this.printOrbitMessage(before.trim());
            process.stdout.write(renderDiffBlock(diffMatch[1]));
            if (after.trim()) this.printOrbitMessage(after.trim());
          } else {
            process.stdout.write(renderDiffBlock(cmdText));
          }
        } else {
          this.printOrbitMessage(cmdText);
        }
        this.showPrompt();
        break;
      }

      case "command_error":
        this.spinner.stop();
        this.finishStream();
        process.stdout.write(`\n${C.error}⚠${RESET} ${msg.text || msg.message || "Error"}\n`);
        this.showPrompt();
        break;

      case "task_plan":
        process.stdout.write(`\n${C.accent}📋${RESET} ${C.text}Tarea:${RESET} ${msg.goal || "Nueva tarea"}\n`);
        if (msg.steps) {
          for (const s of msg.steps) {
            const name = typeof s === "string" ? s : s.name || s.tool || "Paso";
            process.stdout.write(`  ${C.dim}→ ${name}${RESET}\n`);
          }
        }
        break;

      case "task_complete":
        process.stdout.write(`\n${C.success}✓${RESET} ${C.text}Tarea completada${RESET}\n`);
        if (msg.summary) this.printOrbitMessage(msg.summary);
        this.showPrompt();
        break;

      case "task_step_done":
        process.stdout.write(`  ${C.success}✓${RESET} ${C.dim}${msg.step || "Paso"}${RESET}\n`);
        break;

      case "task_step_error":
        process.stdout.write(`  ${C.error}✗${RESET} ${C.dim}${msg.step || "Paso"}${RESET}\n`);
        if (msg.message) process.stdout.write(`    ${C.error}${msg.message}${RESET}\n`);
        break;

      case "memory":
        if (msg.key) {
          process.stdout.write(`\n${C.accent}🧠${RESET} ${C.text2}${msg.key}${RESET} = ${C.dim}${msg.value}${RESET}\n`);
        }
        break;

      case "confirm_action":
        this.handleConfirm(msg);
        break;

      case "error":
        this.spinner.stop();
        process.stdout.write(`\n${C.error}Error:${RESET} ${msg.message || "Error desconocido"}\n`);
        this.showPrompt();
        break;

      case "chat_cleared":
        this.tokensUsed = 0;
        this.turnCount = 0;
        process.stdout.write(`\n${C.dim}Chat limpiado.${RESET}\n`);
        this.showPrompt();
        break;

      // Silently ignore internal types
      case "connected":
      case "ping":
      case "subagent_spawned":
      case "subagent_done":
      case "subagent_failed":
      case "task_queued":
      case "task_progress":
      case "task_cancelled":
      case "task_replan":
        break;
    }
  }

  private printOrbitMessage(text: string) {
    if (!text) return;
    const rendered = renderTerminalMarkdown(text);
    const lines = rendered.split("\n");
    // Print with orbit indicator on first line
    process.stdout.write(`\n${C.accent}◆${RESET} ${BOLD}${C.accent}Orbit${RESET}\n`);
    for (const line of lines) {
      process.stdout.write(`  ${line}\n`);
    }
  }

  /** Heuristic token estimation (~4 chars per token) when backend doesn't report */
  private estimateTokens(text: string) {
    if (!text) return;
    this.tokensUsed += Math.ceil(text.length / 4);
  }

  private finishStream() {
    if (this.streaming) {
      this.streaming = false;
      // Re-render the buffered stream with full markdown
      if (this.streamBuf.trim()) {
        // Move cursor up to overwrite raw stream, then print formatted
        const rawLines = this.streamBuf.split("\n").length;
        // Move up rawLines
        for (let i = 0; i < rawLines; i++) {
          process.stdout.write(`${ESC}A${ESC}K`);
        }
        this.printOrbitMessage(this.streamBuf);
      }
      this.streamBuf = "";
    }
  }

  // ─── Input handler ──────────────────────────────────────────

  private handleInput(line: string) {
    const text = line.trim();

    if (!text) {
      this.showPrompt();
      return;
    }

    // Save to history (skip duplicates of last entry)
    if (this.inputHistory.length === 0 || this.inputHistory[0] !== text) {
      this.inputHistory.unshift(text);
      if (this.inputHistory.length > 200) this.inputHistory.pop();
    }
    this.historyIndex = -1;

    // Local commands
    if (text === "/exit" || text === "/quit") {
      process.stdout.write(`${C.dim}¡Hasta luego!${RESET}\n`);
      this.cleanup();
      process.exit(0);
    }

    if (text === "/help") {
      process.stdout.write(showSlashHelp());
      this.showPrompt();
      return;
    }

    if (text === "/compact") {
      this.compactMode = !this.compactMode;
      process.stdout.write(`${C.dim}Modo compacto: ${this.compactMode ? "activado" : "desactivado"}${RESET}\n`);
      this.showPrompt();
      return;
    }

    if (!this.connected) {
      process.stdout.write(`${C.error}No conectado a Orbit Gateway.${RESET} ${C.dim}Esperando reconexión...${RESET}\n`);
      this.showPrompt();
      return;
    }

    // Print user message
    process.stdout.write(`${ESC}A${ESC}K`); // Move up, clear line (overwrite prompt+input)
    process.stdout.write(`\n${C.user}▎${RESET} ${C.text}${text}${RESET}\n`);

    // Estimate user input tokens
    this.estimateTokens(text);

    // Phase 6: UserMessage hook
    runHooks("UserMessage", { event: "UserMessage", cwd: process.cwd(), user_message: text }).catch(() => {});

    // Send to gateway
    this.sendWs({ type: "chat", payload: { text } });
    this.spinner.start("Pensando...");
  }

  // ─── Confirm dialog ─────────────────────────────────────────

  private allowedActions = new Set<string>();
  private deniedActions = new Set<string>();

  private async handleConfirm(msg: any) {
    this.spinner.stop();
    const action = msg.action || "Confirmar acción";
    const desc = msg.description || msg.action || "";
    const actionKey = msg.tool || msg.action || "";

    // Auto-resolve if previously set to always allow/deny
    if (actionKey && this.allowedActions.has(actionKey)) {
      this.sendWs({ type: "confirm_response", confirmId: msg.confirmId, confirmed: true });
      process.stdout.write(`  ${C.dim}↳ ${action} (auto-permitido)${RESET}\n`);
      return;
    }
    if (actionKey && this.deniedActions.has(actionKey)) {
      this.sendWs({ type: "confirm_response", confirmId: msg.confirmId, confirmed: false });
      process.stdout.write(`  ${C.dim}↳ ${action} (auto-denegado)${RESET}\n`);
      return;
    }

    process.stdout.write(`\n${C.warning}⚠${RESET}  ${BOLD}${action}${RESET}\n`);
    if (desc && desc !== action) {
      process.stdout.write(`   ${C.dim}${desc}${RESET}\n`);
    }

    // Use readline question for confirmation
    if (this.rl) {
      const answer = await new Promise<string>((resolve) => {
        process.stdout.write(`   ${C.text2}¿Confirmar? ${C.dim}(s/N/a=siempre/d=denegar siempre)${RESET} `);
        this.rl!.once("line", resolve);
      });

      const a = answer.trim().toLowerCase();
      let confirmed = false;

      if (a === "a" || a === "always") {
        confirmed = true;
        if (actionKey) this.allowedActions.add(actionKey);
        process.stdout.write(`   ${C.success}✓ Siempre permitido: ${actionKey || action}${RESET}\n`);
      } else if (a === "d" || a === "deny") {
        confirmed = false;
        if (actionKey) this.deniedActions.add(actionKey);
        process.stdout.write(`   ${C.error}✗ Siempre denegado: ${actionKey || action}${RESET}\n`);
      } else if (a === "s" || a === "si" || a === "y" || a === "yes") {
        confirmed = true;
        process.stdout.write(`   ${C.success}✓ Confirmado${RESET}\n`);
      } else {
        confirmed = false;
        process.stdout.write(`   ${C.error}✗ Cancelado${RESET}\n`);
      }

      this.sendWs({ type: "confirm_response", confirmId: msg.confirmId, confirmed });
      this.showPrompt();
    }
  }

  // ─── Cleanup ────────────────────────────────────────────────

  private cleanup() {
    this.shouldExit = true;
    this.spinner.stop();
    const duration = Math.round((Date.now() - this.sessionStartTime) / 1000);
    runHooks("SessionEnd", { event: "SessionEnd", cwd: process.cwd(), session_duration_s: duration }).catch(() => {});
    if (this.ws) {
      try { this.ws.close(); } catch {}
    }
    if (this.rl) {
      try { this.rl.close(); } catch {}
    }
  }
}

// ─── Entry point ────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);

  // Parse flags
  const opts: CLIOptions = {};

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--model" && args[i + 1]) { opts.model = args[++i]; }
    else if (arg === "--no-logo") { opts.noLogo = true; }
    else if (arg === "--compact") { opts.compact = true; }
    else if (arg === "--port" && args[i + 1]) { opts.wsPort = parseInt(args[++i], 10); }
    else if (arg === "chat") { /* subcommand, ignore */ }
    else if (arg === "--help" || arg === "-h") {
      console.log(`
${BOLD}Orbit AI${RESET} — Chat interactivo en terminal

${BOLD}Uso:${RESET}
  orbit chat [opciones]

${BOLD}Opciones:${RESET}
  --model <nombre>   Proveedor de IA (gemini, openai, anthropic, ollama)
  --no-logo          No mostrar banner de inicio
  --compact          Mostrar logo condensado
  --port <numero>    Puerto del WebSocket gateway (default: 18789)
  -h, --help         Mostrar esta ayuda

${BOLD}Atajos:${RESET}
  Ctrl+C             Detener generación / Salir
  /help              Ver comandos slash
  /exit              Salir
`);
      process.exit(0);
    }
  }

  const cli = new OrbitCLI(opts);
  initHooks();
  await cli.start();
}

main().catch((e) => {
  console.error(`${C.error}Error fatal:${RESET} ${e.message}`);
  process.exit(1);
});

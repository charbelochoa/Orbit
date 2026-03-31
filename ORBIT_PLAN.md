# ORBIT — Plan de Implementación v2
> Inspirado en OpenClaw. Mejor arquitectura, más fases, completamente funcional.
> Fecha: 2026-03-27

---

## Estado Actual de Orbit

| Componente | Estado | Calidad |
|---|---|---|
| Gemini Live API (WebSocket raw) |  Funciona | Buena |
| Memoria (JSON + SQLite) |  Funciona | Básica — sin compactación, sin búsqueda semántica |
| Agente Planner/Executor |  Funciona | Básico — sin retry inteligente, sin replan |
| Error Handler |  Funciona | Solo patrones regex, sin LLM |
| Task Queue |  Funciona | Sin notificaciones, sin cancel granular |
| Actions (browser/computer/cmd/file/screen/web) |  Funciona | Sólida base |
| Web UI + Gateway WebSocket |  Funciona | Básica |
| Python YOLO Vision Sidecar |  Funciona | Sin cambios |
| Electron + System Tray |  Funciona | Integrado |
| Chat UI Dark Purple v2 |  Funciona | Diseño portado de orbit-chat |
| Pixel Art Orb Overlay |  Funciona | Portado de orbit-chat, gateway bridge |
| Typing Indicators |  Funciona | 3 estados en UI + orbe |
| Plugin System |  No existe | — |
| Hook System |  No existe | — |
| Skills System |  No existe | — |
| Multi-Provider |  Solo Gemini | — |
| Command Detection |  No existe | — |
| Daemon / Autostart |  No existe | — |
| Memory Compaction |  No existe | — |
| Semantic Memory Search |  No existe | — |

---

## Arquitectura Objetivo

```
┌─────────────────────────────────────────────────────────────────┐
│                         ORBIT  v2                               │
│                                                                 │
│  ┌─────────────┐    ┌──────────────┐    ┌───────────────────┐  │
│  │  Electron   │    │   Web UI     │    │  CLI Commands     │  │
│  │  (Tray+Win) │    │  (port 3000) │    │  orbit install    │  │
│  └──────┬──────┘    └──────┬───────┘    └────────┬──────────┘  │
│         │                  │                     │             │
│         └───────────────────────────────────────┘             │
│                     ┌──────────────┐                           │
│                     │   Gateway    │  WebSocket :18789         │
│                     │  (server.ts) │  + ReplyDispatcher        │
│                     │  Commands /  │  + Typing Indicators      │
│                     └──────┬───────┘                           │
│                            │                                   │
│              ┌───────────────────────────┐                    │
│              │         CORE ENGINE         │                    │
│              │       (index.ts)            │                    │
│              │  Gemini Live ↔ Tool Router  │                    │
│              │  Hook invocation pipeline   │                    │
│              └──┬─────────┬───────────┬───┘                    │
│                 │         │           │                        │
│         ┌─────────┐  ┌───────┐  ┌────────────┐            │
│         │ Context  │  │ Agent  │  │  Plugin      │            │
│         │ Engine   │  │ v2     │  │  System      │            │
│         │(Memory)  │  │Planner │  │ registry.ts  │            │
│         │bootstrap │  │Exec v2 │  │ hooks.ts     │            │
│         │ingest    │  │ErrHdlr │  │ slots.ts     │            │
│         │assemble  │  │Spawn   │  │              │            │
│         │compact   │  │Queue   │  │              │            │
│         └────┬─────┘  └───┬────┘  └──────┬───────┘            │
│              │             │              │                    │
│         ┌──────┐    ┌────────┐   ┌───────────┐            │
│         │Legacy │    │Skills   │   │Providers   │            │
│         │LanceDB│    │Registry │   │Gemini      │            │
│         │(slot) │    │SKILL.md │   │Anthropic   │            │
│         └───────┘    └─────────┘   │OpenAI      │            │
│                                    └────────────┘            │
│                                                               │
│  ┌──────────────────────────────────────────────────────────┐ │
│  │              ACTIONS (Tools para Gemini)                 │ │
│  │  browser · computer · cmd · file · screen · web-search  │ │
│  │  vision-detect · vision-click · agent_task              │ │
│  └──────────────────────────────────────────────────────────┘ │
│                                                               │
│  ┌────────────────────────┐  ┌──────────────────────────────┐ │
│  │  Python YOLO Sidecar   │  │   Daemon / Autostart         │ │
│  │  orbit_engine.py :18790│  │   Windows Task Scheduler     │ │
│  └────────────────────────┘  └──────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
```

---

## FASES DE IMPLEMENTACIÓN

---

### FASE 1 — ContextEngine: Memoria v2
**Objetivo:** Reemplazar la memoria básica (JSON+SQLite) con una interfaz pluggable inspirada en OpenClaw. Soporte para compactación automática, búsqueda semántica y múltiples backends.

**Por qué primero:** Todo lo demás (agente, skills, UI) depende de memoria sólida.

**Archivos a crear:**
```
src/memory/
├── types.ts              ← Interface ContextEngine + tipos de resultado
├── context-engine.ts     ← Implementación default (JSONL, como OpenClaw legacy)
├── compactor.ts          ← Compactación: resume turns viejos con Gemini
├── registry.ts           ← Registry + slot system (como OpenClaw)
├── embeddings.ts         ← Provider de embeddings (Gemini Embedding API)
└── semantic-search.ts    ← Búsqueda semántica sobre memories embeddadas
```

**Archivos a modificar:**
```
src/memory/memory-manager.ts   ← Adaptar a ContextEngine interface
src/index.ts                   ← Usar ContextEngine.assemble() para el prompt
```

**Interface clave:**
```typescript
interface ContextEngine {
  bootstrap(sessionId: string): Promise<BootstrapResult>;
  ingest(sessionId: string, msg: Message): Promise<IngestResult>;
  assemble(sessionId: string): Promise<AssembleResult>; // → system prompt section
  compact(sessionId: string): Promise<CompactResult>;   // → resume turns viejos
  afterTurn(sessionId: string): Promise<void>;
}
interface AssembleResult {
  systemPromptAddition: string;   // Inyectado al system prompt de Gemini
  estimatedTokens: number;
}
```

**Compactación automática:**
- Cada 20 turnos, Orbit llama a `compact()` en background
- Gemini resume los turnos más viejos en un bloque de memoria estructurada
- El resumen se guarda en `data/memory/sessions/<sessionId>/compact.md`
- Los turnos originales se archivan (no se borran)

**Slot system:**
```typescript
// config.yml (futuro):
// memory.engine: "legacy"    ← default
// memory.engine: "lancedb"   ← vectorial
registerContextEngine("legacy", () => new LegacyContextEngine());
registerContextEngine("lancedb", () => new LanceDBContextEngine());
```

**Definición de DONE:**
- [ ] `ContextEngine` interface implementada y tipada
- [ ] LegacyContextEngine usa JSONL para transcripts
- [ ] Compactación automática cada 20 turnos con Gemini
- [ ] `assemble()` devuelve sección relevante del historial para el prompt
- [ ] Registry con slot "legacy" por defecto
- [ ] Tests de bootstrap/ingest/assemble/compact

---

### FASE 2 — Hook System
**Objetivo:** Sistema de hooks de ciclo de vida que permite interceptar puntos clave de ejecución sin modificar el core.

**Por qué:** Habilita logging, analytics, seguridad y extensibilidad sin acoplamiento.

**Archivos a crear:**
```
src/hooks/
├── types.ts      ← HookName enum + handler types
├── registry.ts   ← Hook registry (Map<name, handler[]>)
└── built-in.ts   ← Hooks predefinidos (logging, safety check)
```

**Hooks de ciclo de vida:**
```typescript
type HookName =
  | "beforeToolCall"        // Antes de ejecutar una tool
  | "afterToolCall"         // Después, con resultado
  | "beforeAgentStart"      // Antes de iniciar un task de agente
  | "afterAgentComplete"    // Agente terminó
  | "onSessionCreate"       // Nueva sesión
  | "onMemoryCompact"       // Memoria compactada
  | "onGeminiMessage"       // Mensaje llegó de Gemini
  | "onUserMessage"         // Usuario envió mensaje
  | "beforeMemoryAssemble"; // Antes de construir el context prompt
```

**Uso:**
```typescript
registerHook("beforeToolCall", async (ctx) => {
  console.log(`[Hook] Tool: ${ctx.toolName}`, ctx.args);
  // Retornar { block: true } para cancelar la tool
});

registerHook("afterToolCall", async (ctx) => {
  metrics.record(ctx.toolName, ctx.duration);
});
```

**Built-in hooks:**
- **SafetyHook**: Bloquea tools peligrosas en modo seguro (borrar sistema, etc.)
- **LoggingHook**: Log estructurado de todas las tool calls con timing
- **AnalyticsHook**: Conteo de uso por tool para stats en UI

**Definición de DONE:**
- [ ] HookRegistry funcional con registro múltiple de handlers
- [ ] Los hooks se invocan correctamente en el executor
- [ ] Hook `beforeToolCall` puede bloquear ejecución
- [ ] Built-in safety + logging hooks activos por defecto

---

### FASE 3 — Plugin System
**Objetivo:** Sistema de plugins que permite registrar tools, hooks, providers y skills sin tocar el core. Carga automática desde `plugins/` local.

**Por qué:** Hace Orbit infinitamente extensible sin modificar el proyecto base.

**Archivos a crear:**
```
src/plugins/
├── types.ts       ← OrbitPluginApi interface
├── registry.ts    ← Plugin registry central
├── loader.ts      ← Auto-carga desde plugins/ directory
└── sdk.ts         ← definePluginEntry() helper
```

**Plugin API:**
```typescript
interface OrbitPluginApi {
  registerTool(factory: ToolFactory, opts?: ToolOpts): void;
  registerHook(name: HookName, handler: HookHandler, opts?: HookOpts): void;
  registerProvider(provider: LLMProvider): void;
  registerSkill(skill: Skill): void;
  registerCommand(name: string, handler: CommandHandler): void;
  registerMemoryEngine(id: string, factory: ContextEngineFactory): void;
}

// Plugin entry point
export default definePlugin({
  id: "my-plugin",
  name: "Mi Plugin",
  version: "1.0.0",
  register(api: OrbitPluginApi) {
    api.registerTool(() => ({
      name: "my_tool",
      description: "...",
      execute: async (args) => { ... }
    }));
  }
});
```

**Estructura de plugins:**
```
plugins/                       ← Plugins locales (auto-cargados)
├── my-plugin/
│   ├── index.ts               ← definePlugin(...)
│   └── package.json
└── another-plugin/
    └── index.ts
```

**Carga automática:**
- Al iniciar, Orbit escanea `plugins/` y carga cada directorio con `index.ts`
- Plugins pueden ser npm packages (`plugins/node_modules/orbit-plugin-x/`)
- Cada plugin registra sus tools en el ToolRegistry
- Las tool declarations se pasan a Gemini junto con las built-in

**Definición de DONE:**
- [ ] Plugin registry funcional
- [ ] `definePlugin()` helper tipado
- [ ] Auto-carga desde `plugins/` al iniciar
- [ ] Tool plugins se registran correctamente y Gemini las ve
- [ ] Hook plugins interceptan ciclo de vida
- [ ] Un plugin de ejemplo incluido (`plugins/example/`)

---

### FASE 4 — Agente v2: Planner + Executor Mejorados
**Objetivo:** Agente mucho más inteligente con RETRY/SKIP/REPLAN/ABORT basado en LLM, inyección de contexto entre pasos, spawn aislado de sub-agentes.

**Por qué:** El agente actual es demasiado básico. Si un paso falla, se rompe todo.

**Archivos a modificar/crear:**
```
src/agent/
├── planner.ts         ← REWRITE: replan(), plan con contexto previo
├── executor.ts        ← REWRITE: inyección de contexto, hook calls
├── error-handler.ts   ← REWRITE: LLM decide RETRY/SKIP/REPLAN/ABORT
├── task-queue.ts      ← UPDATE: notificaciones, cancel granular, priorities
└── spawn.ts           ← NEW: spawn aislado de sub-agentes (tipo ACP)
```

**Error Handler v2 (LLM-powered):**
```typescript
type ErrorDecision = "RETRY" | "SKIP" | "REPLAN" | "ABORT";

async function analyzeError(step, error, attempt, context): Promise<ErrorDecision> {
  // 1. Patrones conocidos → decisión rápida sin LLM
  // 2. Si no hay patrón → Gemini 2.5 Flash Lite decide
  const prompt = `
    Task: ${context.goal}
    Step ${step.step}: ${step.tool} — ${step.description}
    Error: ${error}
    Attempt: ${attempt}/3
    Previous results: ${context.previousResults}

    Decide: RETRY | SKIP | REPLAN | ABORT
    Reason: <brief>
  `;
  // Retorna decisión + razón + posible fix
}
```

**Planner v2 — Replan:**
```typescript
async function replan(
  goal: string,
  completedSteps: StepResult[],
  failedStep: Step,
  error: string
): Promise<Plan> {
  // Genera plan alternativo conociendo qué ya funcionó
  // y por qué falló el paso actual
}
```

**Executor v2 — Context injection:**
```typescript
// Resultados anteriores se inyectan en los parámetros del paso siguiente
// Ejemplo: paso 1 hace web_search → resultado se pasa a paso 2 file_controller
function injectContext(step: Step, previousResults: StepResult[]): Step {
  // Reemplaza placeholders {{step_1_result}} en parámetros
}
```

**Spawn aislado (tipo ACP):**
```typescript
// En vez de bloquear la conversación principal, spawn una tarea en background
async function spawnTask(params: {
  goal: string;
  priority: TaskPriority;
  onComplete?: (result: string) => void;
  onProgress?: (update: string) => void;
}): Promise<string> { // → taskId
```

**Definición de DONE:**
- [ ] Error handler usa Gemini para decisiones cuando no hay patrón conocido
- [ ] Planner puede replanificar con contexto de lo que ya ejecutó
- [ ] Executor inyecta resultados de pasos previos en los siguientes
- [ ] Spawn crea task aislada que notifica al completar
- [ ] Task queue soporta cancel por taskId
- [ ] El agente completa tareas de 5+ pasos sin romperse

---

### FASE 5 — Skills System
**Objetivo:** Sistema de skills basado en SKILL.md (mismo formato que OpenClaw) que enseña a Orbit cómo usar herramientas externas y qué patrones seguir.

**Por qué:** Los skills son el "manual de operaciones" del agente. Sin skills, el agente improvisa mal.

**Archivos a crear:**
```
src/skills/
├── types.ts       ← Skill interface + metadata
├── registry.ts    ← Skill registry + búsqueda
└── loader.ts      ← Lee SKILL.md files desde skills/

skills/            ← Skills incluidos
├── coding/
│   └── SKILL.md   ← Cómo delegar código a Claude Code
├── web-research/
│   └── SKILL.md   ← Cómo investigar en internet
├── file-ops/
│   └── SKILL.md   ← Patrones para gestión de archivos
├── windows-control/
│   └── SKILL.md   ← Control de Windows (PowerShell, apps)
├── browser-automation/
│   └── SKILL.md   ← Automatización web con Puppeteer
├── github/
│   └── SKILL.md   ← PRs, Issues, GitHub CLI (portado de OpenClaw)
├── notion/
│   └── SKILL.md   ← Integración Notion (portado de OpenClaw)
└── spotify/
    └── SKILL.md   ← Control Spotify (portado de OpenClaw)
```

**Skill SKILL.md format:**
```markdown
---
name: web-research
description: 'Cuándo usar: buscar información actual, comparar opciones, obtener datos de noticias...'
metadata:
  orbit:
    emoji: 
    category: research
    tools: [web_search, browser_control, file_controller]
---
# Web Research

## Patrón básico
1. `web_search` para obtener resultados
2. `browser_control go_to` para leer artículos completos
3. `file_controller write` para guardar el resumen

##  Reglas
- SIEMPRE cita las fuentes
- NO inventes datos — si no encuentras algo, dilo
...
```

**Cómo los skills se integran al agente:**
- Al iniciar, SkillRegistry carga todos los SKILL.md
- El Planner recibe los skills relevantes para el goal dado
- El system prompt incluye los skills aplicables
- Comando `/skills` en UI lista todos los disponibles

**Definición de DONE:**
- [ ] SkillLoader lee SKILL.md correctamente
- [ ] SkillRegistry permite buscar por nombre/categoría/tool
- [ ] 8 skills incluidos y funcionando
- [ ] Planner recibe skills relevantes al planificar
- [ ] Comando `/skills list` funciona en la UI
- [ ] Skills de OpenClaw portados: github, notion, spotify

---

### FASE 6 — Command Detection + ReplyDispatcher
**Objetivo:** Sistema de comandos tipo `/task`, `/memory`, `/skills` + dispatcher que maneja concurrencia y muestra typing indicators en la UI.

**Por qué:** La UI actual no tiene feedback visual mientras Orbit procesa. Y no hay forma de dar comandos directos.

**Archivos a crear:**
```
src/auto-reply/
├── types.ts               ← CommandDef + ReplyDispatcher types
├── command-detection.ts   ← Detectar /comando en mensajes
├── dispatcher.ts          ← ReplyDispatcher con concurrencia
└── commands/
    ├── task.ts            ← /task <goal>
    ├── memory.ts          ← /memory search <query>
    ├── skills.ts          ← /skills list | /skills help <name>
    ├── status.ts          ← /status
    └── cancel.ts          ← /cancel <taskId>
```

**Comandos soportados:**
```
/task "investiga los mejores frameworks de IA 2025 y guarda un resumen"
  → Crea un AgentTask de alta prioridad

/memory search "qué proyectos discutimos?"
  → Busca en memoria y responde directamente

/memory show
  → Muestra el contenido de la memoria actual

/skills list
  → Lista todos los skills disponibles

/skills help coding
  → Muestra el SKILL.md de "coding"

/status
  → Muestra tareas en cola, memoria usada, provider activo

/cancel task_123abc
  → Cancela una tarea en ejecución

/clear
  → Limpia el historial de la sesión actual

/model gemini-2.5-flash
  → Cambia el modelo en runtime
```

**Typing Indicators:**
```typescript
// Mientras Gemini procesa → UI muestra "Orbit está pensando..."
// Mientras ejecuta tool → UI muestra "Ejecutando: web_search..."
// Mientras genera → UI muestra indicador animado

class ReplyDispatcher {
  setTypingState(state: "thinking" | "executing" | "idle", tool?: string): void
  // → broadcast({ type: "typing", state, tool }) al WebSocket
}
```

**Definición de DONE:**
- [ ] CommandDetection detecta todos los comandos listados
- [ ] Cada comando tiene su handler
- [ ] Typing indicators visibles en la UI (3 estados: thinking/executing/idle)
- [ ] ReplyDispatcher maneja concurrencia (no responder 2 veces a la vez)
- [ ] UI actualizada para mostrar typing animado

---

### FASE 7 — Multi-Provider
**Objetivo:** Abstracción de provider LLM para poder usar Gemini, Anthropic o OpenAI según config. El primero en funcionar es Gemini (ya existe), pero el sistema está listo para más.

**Por qué:** No depender de un único proveedor. Si Gemini falla → fallback automático.

**Archivos a crear:**
```
src/providers/
├── types.ts          ← LLMProvider interface
├── registry.ts       ← Provider registry
├── gemini.ts         ← Gemini Live (actual implementación en index.ts)
├── anthropic.ts      ← Anthropic Messages API (no Live)
└── openai.ts         ← OpenAI Chat API (no Live)
```

**Provider interface:**
```typescript
interface LLMProvider {
  id: string;
  name: string;
  models: string[];

  connect(config: ProviderConfig): Promise<void>;
  sendMessage(msg: string, tools: ToolDeclaration[]): Promise<AsyncStream<LLMChunk>>;
  executeTools(calls: ToolCall[]): Promise<ToolResult[]>;
  disconnect(): void;
}
```

**Config:**
```env
# .env
GEMINI_API_KEY=...       ← Provider primario
ANTHROPIC_API_KEY=...    ← Fallback
OPENAI_API_KEY=...       ← Fallback 2

ORBIT_PROVIDER=gemini    ← Cuál usar (default: gemini)
ORBIT_MODEL=models/gemini-2.5-flash-exp
```

**Fallback automático:**
- Si Gemini falla 3 veces → intentar con Anthropic
- Log claro de qué proveedor está activo
- UI muestra provider activo en el header

**Definición de DONE:**
- [ ] LLMProvider interface definida
- [ ] GeminiProvider extrae la lógica actual de index.ts
- [ ] AnthropicProvider funcional (texto, sin audio Live)
- [ ] Variable ORBIT_PROVIDER en .env selecciona el provider
- [ ] Fallback automático al siguiente provider disponible
- [ ] UI muestra provider activo

---

### FASE 8 — Daemon & Autostart Windows
**Objetivo:** Orbit se instala como servicio del sistema en Windows. Arranca automáticamente al iniciar sesión, se reinicia si falla.

**Por qué:** Un asistente que hay que arrancar manualmente no es un asistente real.

**Archivos a crear:**
```
src/daemon/
├── types.ts          ← DaemonService interface
├── windows.ts        ← Windows Task Scheduler (schtasks)
├── service.ts        ← Cross-platform dispatcher
└── paths.ts          ← Log paths, config paths
```

**Windows Task Scheduler:**
```typescript
// orbit install → registra la tarea
async function installDaemon(): Promise<void> {
  // schtasks /Create /TN "Orbit AI" /TR "electron.exe orbit/electron/main.cjs"
  // /SC ONLOGON /DELAY 0001:00 /IT /F
}

// orbit uninstall → elimina la tarea
async function uninstallDaemon(): Promise<void> {
  // schtasks /Delete /TN "Orbit AI" /F
}
```

**CLI:**
```
orbit install    → Instala el daemon (Task Scheduler)
orbit uninstall  → Desinstala el daemon
orbit status     → Estado del daemon
orbit logs       → Últimas 100 líneas de logs
```

**Crash recovery:**
- Task Scheduler configurado para reiniciar en fallo (3 intentos, 1 min entre cada uno)
- Logs rotativos en `%APPDATA%\Orbit\logs\`

**Definición de DONE:**
- [ ] `orbit install` registra tarea en Task Scheduler
- [ ] `orbit uninstall` elimina la tarea
- [ ] Orbit arranca automáticamente al iniciar sesión de Windows
- [ ] Se reinicia automáticamente si falla
- [ ] Logs guardados en `%APPDATA%\Orbit\logs\`

---

### FASE 9 — Enhanced Web UI
**Objetivo:** Dashboard completo con todas las features: chat, memoria, tasks en cola, timeline de tools, configuración.

**Por qué:** La UI actual es un chat básico. Necesitamos visibilidad de todo lo que hace Orbit.

**Nuevo layout:**
```
┌─────────────────────────────────────────────────────┐
│   ORBIT AI          [Gemini ]  [v2.0]  [ Settings] │
├──────────────┬──────────────────────────────────────┤
│              │                                      │
│   TASKS    │   CHAT                             │
│  ─────────── │  ─────────────────────────────────── │
│   Researching│ [User] investiga los mejores...     │
│    AI trends  │                                     │
│   Pending    │ [Orbit]  Pensando...              │
│  ─────────── │   └─  web_search                  │
│   MEMORY   │      └─ "AI frameworks 2025"        │
│  ─────────── │                                     │
│  • Nombre: HP │ [Orbit] He encontrado los siguientes│
│  • Ciudad: MX │ frameworks más relevantes...       │
│  • Proyecto:  │                                    │
│    Orbit AI   │                                    │
│  ─────────── │ ┌─────────────────────────────────┐ │
│   TOOLS    │ │ > Pregunta a Orbit...       [↑] │ │
│  web_search  │ └─────────────────────────────────┘ │
│  browser     │                                    │
│  computer    │                                    │
└──────────────┴──────────────────────────────────────┘
```

**Tabs:**
1. **Chat** — conversación principal (mejorado con typing indicators)
2. **Tasks** — cola de tareas con progreso en tiempo real
3. **Memory** — browser de la memoria (buscar, editar, ver historial)
4. **Tools** — timeline de tool calls con timing y resultados
5. **Settings** — provider, modelo, API keys, skills activos

**Mejoras al chat:**
- Typing indicator animado (3 dots) con estado: "Pensando / Ejecutando: web_search / Escribiendo..."
- Colapsable tool calls inline (mostrar/ocultar resultado)
- Mensajes con formato markdown renderizado
- Código con syntax highlighting
- Scroll infinito con historial

**Definición de DONE:**
- [ ] Layout de 2 columnas implementado
- [ ] Tab Tasks muestra cola en tiempo real
- [ ] Tab Memory permite buscar en historial
- [ ] Tab Tools muestra timeline de ejecución
- [ ] Tab Settings permite cambiar config en caliente
- [ ] Typing indicators con 3 estados implementados
- [ ] Tool calls colapsables en el chat

---

### FASE 11 — Pixel Art Orb: Mascota en Pantalla (Overlay Electron)
**Objetivo:** Recrear el icónico orbe pixel-art de Orbit como ventana Electron transparente, siempre visible sobre cualquier app. Se mueve, anima, habla y reacciona a Orbit en tiempo real.

**Por qué:** El orbe es la identidad visual de Orbit. Es lo que diferencia a un asistente de IA de una simple ventana de chat. Tomado de `orbit-chat/overlay.html` (diseño original pixel art) y `main.js` (arquitectura de overlay).

**Archivos a crear:**
```
electron/
├── overlay.cjs           ← Lógica del overlay window (extraída de orbit-chat/main.js)
└── overlay-preload.cjs   ← Context bridge para el overlay

src/ui/overlay/
└── overlay.html          ← Pixel art orb, física, animaciones (portado de orbit-chat)
```

**Arquitectura del Overlay (portada de orbit-chat/main.js):**
```typescript
// overlay window: transparente, siempre on-top, click-through por defecto
overlayWindow = new BrowserWindow({
  frame: false, transparent: true, alwaysOnTop: true,
  skipTaskbar: true, focusable: false, hasShadow: false,
  webPreferences: { preload: 'electron/overlay-preload.cjs' }
});
overlayWindow.setIgnoreMouseEvents(true, { forward: true });
overlayWindow.setAlwaysOnTop(true, 'screen-saver');
```

**Canvas Pixel Art (portado de orbit-chat/overlay.html):**
```javascript
// Paleta de colores (9 tonos + transparente)
const PAL = {
  0: 'transparent',
  1: '#7c6af7',   // purple base
  2: '#a89df9',   // purple light
  3: '#c4b9fb',   // purple lighter
  4: '#1e1b4b',   // dark purple
  5: '#ffffff',   // white
  6: '#f472b6',   // pink (boca/mejillas)
  7: '#fbbf24',   // yellow (destellos)
  8: '#0a0b0f',   // dark bg
  9: '#6ee7b7',   // green (OK state)
};

// Sprites 16×16 (idle, walk, sleep, point, happy)
// Física: position(x,y), velocity(vx,vy), friction=0.92
// Bobbing: y += Math.sin(Date.now()/400) * 0.4
// Wander: cada 3-6s, nueva dirección aleatoria
```

**Estados del orbe:**
| Estado | Color dot | Animación | Cuándo |
|--------|-----------|-----------|--------|
| idle |  purple | bobbing suave | Sin actividad |
| listening |  green | vibra | Escuchando voz |
| thinking |  yellow | parpadea | Gemini procesando |
| speaking |  blue | bounce | Respuesta llegando |
| error |  red | shake | Error ocurrió |
| happy |  purple | jump | Tarea completada |
| sleeping |  gray | zzz | Sin actividad 5min |

**Speech bubble:**
```css
/* Slide in from right, auto-hide after duration */
.speech-bubble {
  background: rgba(28, 25, 75, 0.92);
  border: 1px solid #7c6af7;
  border-radius: 8px;
  padding: 8px 12px;
  font-family: 'Segoe UI', sans-serif;
  font-size: 13px;
  color: #e2e0f8;
  transition: opacity 0.3s ease, transform 0.3s ease;
  max-width: 200px;
}
```

**Drag-and-drop:**
```javascript
// Al arrastrar el orb: deshabilitar click-through temporalmente
// orbitElectron.send('overlay_click_through', false)
// Al soltar: re-habilitar
// orbitElectron.send('overlay_click_through', true)
```

**Sparkle effects:**
- Al hacer click en el orb: 8 partículas en colores del PAL
- Al recibir mensaje: 3 partículas brief
- Partículas flotan y se desvanecen en 600ms

**IPC channels (nuevo en electron/overlay-preload.cjs):**
```javascript
contextBridge.exposeInMainWorld('orbitOverlay', {
  onOrbState: (cb) => ipcRenderer.on('orb_state', (_, s) => cb(s)),
  onOrbSpeak: (cb) => ipcRenderer.on('orb_speak', (_, d) => cb(d)),
  onOrbMove: (cb) => ipcRenderer.on('overlay_move_to', (_, d) => cb(d)),
  setClickThrough: (v) => ipcRenderer.send('overlay_click_through', v),
  toggleChat: () => ipcRenderer.send('overlay_toggle_chat'),
});
```

**Integración con electron/main.cjs:**
```javascript
// Nuevo en createWindow(): al recibir eventos del backend, forward al overlay
// "thinking" → ipc.send(overlayWindow, 'orb_state', { state: 'thinking' })
// "speaking" + texto → ipc.send(overlayWindow, 'orb_speak', { text, duration })
// task completada → ipc.send(overlayWindow, 'orb_state', { state: 'happy' })
```

**Integración con src/gateway/server.ts:**
- Cuando Gemini empieza a responder → estado "speaking"
- Cuando se llama una tool → estado "thinking"
- Cuando hay error → estado "error"
- Orbit envía el texto al overlay para el speech bubble

**Definición de DONE:**
- [ ] Overlay window transparente en toda la pantalla, siempre on-top
- [ ] Pixel art orb renderizado en canvas 16×16 (upscale ×6 = 96×96px)
- [ ] 5 estados de animación (idle, thinking, speaking, error, happy)
- [ ] Speech bubble que aparece con el texto de Orbit
- [ ] Drag-and-drop: el orbe se puede mover libremente
- [ ] Sparkle effects al interactuar
- [ ] Doble click en orbe → toggle chat window
- [ ] Orbe reacciona a eventos del backend (estados en tiempo real)
- [ ] Status dot de color según estado

---

### FASE 12 — Chat UI: Diseño Dark Purple v2
**Objetivo:** Portar el diseño visual de orbit-chat/index.html al Web UI de Orbit. Chat con tema oscuro morado, titlebar custom, burbujas de mensaje estilizadas, diseño profesional.

**Por qué:** La UI actual de Orbit es un dashboard funcional pero sin personalidad. El diseño de orbit-chat tiene una identidad visual fuerte y coherente con el orbe.

**Fuente del diseño:** `orbit-chat/index.html` — CSS variables, titlebar drag region, bubble styles, input area.

**CSS Variables del sistema de diseño:**
```css
:root {
  --bg: #0a0b0f;          /* Background oscuro casi negro */
  --bg2: #0f0e1a;         /* Surface secundario */
  --surface: #12111d;     /* Cards y panels */
  --surface2: #1a1930;    /* Hover states */
  --accent: #7c6af7;      /* Morado principal (actualizado de #6c5ce7) */
  --accent-dim: #4b3fd4;  /* Accent más oscuro */
  --accent-glow: rgba(124, 106, 247, 0.2); /* Glow sutil */
  --text: #e2e0f8;        /* Texto principal */
  --text-dim: #8b89a8;    /* Texto secundario */
  --text-muted: #4a4868;  /* Texto deshabilitado */
  --border: rgba(124, 106, 247, 0.15); /* Bordes sutiles */
  --user-bubble: #1e1b4b; /* Burbuja del usuario */
  --orbit-bubble: #0f0e1a; /* Burbuja de Orbit */
  --success: #6ee7b7;
  --error: #f87171;
  --warning: #fbbf24;
}
```

**Layout del Chat Window:**
```
┌─────────────────────────────────────────────────────┐
│  [][⊡][]   ORBIT   ────── DRAG REGION ─────── │ ← Titlebar custom
│─────────────────────────────────────────────────────│
│  Header: [ Gemini Live ] [ Conectado]           │
│─────────────────────────────────────────────────────│
│                                                     │
│  [User] Investiga los mejores frameworks de IA      │  ← Burbuja usuario (right-aligned)
│                                                     │
│  [] Orbit está pensando...                        │  ← Typing indicator
│                                                 │
│                                                     │
│  [] He encontrado los siguientes frameworks:      │  ← Burbuja Orbit (left-aligned)
│       web_search: "AI frameworks 2025"            │  ← Tool call colapsable
│         5 resultados encontrados                  │
│                                                     │
│─────────────────────────────────────────────────────│
│  [] > Escribe o habla con Orbit...         []  │ ← Input area
└─────────────────────────────────────────────────────┘
```

**Componentes del Chat:**

**Titlebar custom (frameless Electron):**
```html
<!-- Draggable solo en la región del titlebar -->
<div class="titlebar" style="-webkit-app-region: drag">
  <div class="traffic-lights" style="-webkit-app-region: no-drag">
    <button class="btn-close" onclick="minimize()"></button>
    <button class="btn-max" onclick="maximize()">⊡</button>
    <button class="btn-quit" onclick="closeWindow()"></button>
  </div>
  <span class="title"> ORBIT</span>
  <div class="status-badge"> Conectado</div>
</div>
```

**Burbujas de mensaje:**
```css
.message-user .bubble {
  background: var(--user-bubble);
  border: 1px solid var(--accent);
  border-radius: 16px 16px 4px 16px;
  align-self: flex-end;
  padding: 10px 14px;
}

.message-orbit .bubble {
  background: var(--orbit-bubble);
  border: 1px solid var(--border);
  border-radius: 16px 16px 16px 4px;
  align-self: flex-start;
  padding: 10px 14px;
}

/* Avatar del orb en mensajes de Orbit */
.orbit-avatar {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  background: var(--accent);
  display: flex; align-items: center; justify-content: center;
  font-size: 14px;
}
```

**Typing indicator:**
```css
.typing-dots {
  display: flex; gap: 4px; padding: 12px 16px;
}
.typing-dots span {
  width: 6px; height: 6px;
  background: var(--accent);
  border-radius: 50%;
  animation: bounce 1.4s ease-in-out infinite;
}
.typing-dots span:nth-child(2) { animation-delay: 0.2s; }
.typing-dots span:nth-child(3) { animation-delay: 0.4s; }
```

**Tool call inline colapsable:**
```html
<details class="tool-call">
  <summary> web_search: "AI frameworks 2025"</summary>
  <pre class="tool-result">{ "results": [...] }</pre>
</details>
```

**Input area:**
```css
.input-area {
  border-top: 1px solid var(--border);
  padding: 12px 16px;
  display: flex; gap: 8px; align-items: center;
  background: var(--bg2);
}
.input-box {
  flex: 1;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 24px;
  padding: 10px 16px;
  color: var(--text);
  font-size: 14px;
  resize: none;
  outline: none;
  transition: border-color 0.2s;
}
.input-box:focus { border-color: var(--accent); }
```

**Markdown rendering:**
- Usar `marked.js` desde CDN para renderizar respuestas de Orbit
- `highlight.js` para syntax highlighting en bloques de código
- Sanitización con DOMPurify

**Integración con Electron Overlay:**
- El chat window es la misma ventana actual (puerto 3000) pero con diseño renovado
- Cuando el orbe es click-through, el usuario interactúa normalmente con otras apps
- Al hacer doble click en el orbe → el chat window aparece como panel lateral derecho

**Archivos a modificar:**
```
src/ui/web/index.html    ← Rewrite completo con el nuevo diseño
```

**Archivos a crear:**
```
src/ui/web/
├── chat.css             ← Estilos separados (opcional)
├── markdown.js          ← Configuración de marked.js
└── overlay-client.js    ← Comunicación con el orbe
```

**Definición de DONE:**
- [ ] CSS variables del sistema de diseño implementadas
- [ ] Titlebar custom con drag region, minimize/maximize/close
- [ ] Burbujas usuario/Orbit con diseño dark purple
- [ ] Typing indicator con 3 dots animados
- [ ] Tool calls colapsables inline en el chat
- [ ] Markdown rendering con highlight.js para código
- [ ] Input area con mic button y send button estilizados
- [ ] Status badge mostrando provider activo + estado de conexión
- [ ] Animaciones suaves (slide in messages, fade in UI)
- [ ] Diseño responsive: funciona de 400px a 1280px de ancho

---

### FASE 13 — App Registry & Action Executor Mejorado
**Objetivo:** Portar el app registry completo de orbit-chat/action-executor.js al sistema de actions de Orbit, con soporte para 26+ categorías de apps de Windows y métodos de launch inteligentes.

**Por qué:** El action-executor original tiene 200+ apps de Windows mapeadas con sus aliases en español e inglés. Esta es la base del control de aplicaciones en Windows.

**Fuente:** `orbit-chat/action-executor.js` — 26 fases de apps + launch methods.

**Archivos a crear/modificar:**
```
src/actions/
├── app-registry.ts   ← Port de APP_ENTRIES + ALIAS_MAP
├── app-launcher.ts   ← launch methods (shell/path/uri/chrome_tab/win_search)
└── index.ts          ← UPDATE: open_app usa AppLauncher
```

**App Registry (port directo):**
```typescript
// 200+ apps mapeadas con aliases español/inglés
// Métodos: shell | path | uri | chrome_tab | win_search
const APP_ENTRIES: Record<string, AppEntry> = {
  'calculadora': { method: 'uri', target: 'calculator:', aliases: ['calculator','calc','calculadora'] },
  'visual studio code': { method: 'shell', target: 'code', aliases: ['vscode','vs code','code'] },
  // ... 200+ más
};
```

**Launch methods:**
```typescript
// shell: exec('start "" target')
// path: spawn(execPath, [], { detached: true })
// uri: exec('start "" "uri:"')
// chrome_tab: spawn(chromePath, [url], { detached: true })
// win_search: PowerShell SendKeys (Ctrl+Esc → type → Enter)
```

**Fallback inteligente:**
- Si la app no está en registry → win_search con el nombre
- Si el path no existe → win_search con basename
- Si Chrome no está → default browser para URLs

**Definición de DONE:**
- [ ] AppRegistry con 200+ apps mapeadas
- [ ] Aliases en español e inglés
- [ ] Todos los launch methods funcionando en Windows
- [ ] `open_app` tool usa AppRegistry
- [ ] Fallback a win_search si app no está en registry
- [ ] Auto-detección de paths de Office y Chrome

---

### FASE 10 — Integración, Optimización & Calidad
**Objetivo:** Todo funciona junto sin fricción. Orbit arranca rápido, maneja errores graciosamente, los datos persisten correctamente.

**Tareas:**

**Performance:**
- Lazy loading de providers (no conectar Gemini hasta tener API key válida)
- ContextEngine.assemble() en paralelo con la respuesta previa
- Cache de embeddings para búsqueda semántica
- Startup time < 3 segundos hasta "Orbit está en línea"

**Resilencia:**
- Reconexión automática a Gemini con backoff exponencial
- Cola persistente de tareas (sobrevive reinicios de Orbit)
- Memory auto-save cada 5 minutos (no solo al cerrar)

**Seguridad:**
- Safety hook que bloquea comandos peligrosos (rm -rf, format, etc.)
- Sandboxing de comandos shell (lista blanca de operaciones permitidas)
- Rate limiting en la gateway

**Calidad:**
- TypeScript strict mode sin errores
- Tests unitarios para Context Engine + Agent + Hooks
- Logging estructurado (JSON) en modo producción
- Health check endpoint en gateway (`/health`)

**Documentación:**
- `README.md` actualizado con setup completo
- `docs/architecture.md` con diagrama de arquitectura
- `docs/plugins.md` guía para crear plugins
- `docs/skills.md` guía para crear skills

**Definición de DONE:**
- [ ] Startup time < 3 segundos
- [ ] 0 errores TypeScript en modo strict
- [ ] Tests cubriendo las 4 capas críticas
- [ ] README con instrucciones completas
- [ ] Orbit sobrevive reinicio sin perder estado

---

## Resumen de Archivos por Fase

| Fase | Archivos Nuevos | Archivos Modificados |
|------|----------------|---------------------|
| 1 — ContextEngine | src/memory/types.ts, context-engine.ts, compactor.ts, registry.ts, embeddings.ts, semantic-search.ts | memory-manager.ts, index.ts |
| 2 — Hooks | src/hooks/types.ts, registry.ts, built-in.ts | agent/executor.ts, actions/index.ts |
| 3 — Plugins | src/plugins/types.ts, registry.ts, loader.ts, sdk.ts | index.ts |
| 4 — Agente v2 | src/agent/spawn.ts | agent/planner.ts, executor.ts, error-handler.ts, task-queue.ts |
| 5 — Skills | src/skills/types.ts, registry.ts, loader.ts + 8× SKILL.md | agent/planner.ts, core/prompt.ts |
| 6 — Commands | src/auto-reply/types.ts, command-detection.ts, dispatcher.ts, commands/*.ts | gateway/server.ts, index.ts |
| 7 — Multi-Provider | src/providers/types.ts, registry.ts, gemini.ts, anthropic.ts, openai.ts | index.ts |
| 8 — Daemon | src/daemon/types.ts, windows.ts, service.ts, paths.ts | package.json |
| 9 — UI Enhanced | src/ui/web/index.html (rewrite) | ui/web-server.ts |
| 10 — Integración | docs/*.md | Todos |
| 11 — Pixel Art Orb | electron/overlay.cjs, overlay-preload.cjs, src/ui/overlay/overlay.html | electron/main.cjs, gateway/server.ts |
| 12 — Chat UI Dark Purple | src/ui/web/index.html (rewrite), chat.css | gateway/server.ts |
| 13 — App Registry | src/actions/app-registry.ts, app-launcher.ts | src/actions/index.ts |

**Total archivos nuevos: ~50** | **Total archivos modificados: ~18**

---

## Orden de Ejecución Recomendado

```
F1 (Memory) → F2 (Hooks) → F3 (Plugins) → F4 (Agent v2)
     ↓                                          ↓
F5 (Skills) ──────────────────────────────→ F6 (Commands)
     ↓                                          ↓
F7 (Providers) ──────────────────────────→ F9 (UI)
     ↓
F8 (Daemon) → F10 (Integration)

F9 (UI Enhanced) → F11 (Pixel Art Orb) → F12 (Chat UI Dark Purple)
                                               ↓
                              F13 (App Registry) → F10 (Integration)
```

Cada fase es independiente una vez que la anterior está completa.
Las fases 1-4 son el **núcleo duro**. Las fases 5-10 son **multiplicadores de valor**.

---

## Convenciones del Código

- **TypeScript strict** en todo el proyecto
- **Imports `.js`** (ESM, ya configurado)
- **Async/await** — sin callbacks ni Promise chains sin await
- **Error handling** — try/catch explícito, nunca silenciar errores
- **Logging** — `[ComponentName]` prefix en todos los console.log
- **Tests** — `*.test.ts` junto al archivo que prueba
- **Tipos exportados** — todos los types en `types.ts` del módulo
- **No globals** — todo via DI o singletons explícitos

---

*Plan generado: 2026-03-27*
*Versión objetivo: Orbit v2.0*

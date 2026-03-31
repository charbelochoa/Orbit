# PLAN DE INTEGRACION: OpenClaw → Orbit

## Resumen Ejecutivo

Integrar las arquitecturas mas potentes de OpenClaw en Orbit, manteniendo la identidad de Orbit
(asistente local con voz via Gemini Live) pero ganando: multi-proveedor LLM, sistema de plugins,
seguridad por capas, subagentes, compactacion de contexto, y browser automation de nivel produccion.

**Principio rector:** No reescribir Orbit. Extender sus modulos existentes con patrones de OpenClaw.

---

## FASE 0 — INFRAESTRUCTURA BASE (Semana 1)
> Prerequisitos que desbloquean todo lo demas. Sin cambios funcionales visibles.

### 0.1 — Schema Validation con Zod
**Que:** Agregar `zod` como dependencia. Definir schemas para tool parameters, config, memory.
**Donde:** `src/types/schemas.ts` (nuevo)
**Por que:** OpenClaw valida TODO con Zod. Sin esto, no hay seguridad en los datos.
```
npm i zod
```
**Archivos:**
- Crear `src/types/schemas.ts` — schemas de tool params, config, memory store
- Modificar `src/core/tool-registry.ts` — agregar schema Zod junto a cada declaracion

### 0.2 — Config Centralizada (YAML)
**Que:** Reemplazar `.env` disperso con un `config.yaml` central + schema Zod.
**Donde:** `src/config/` (nuevo directorio)
**Archivos:**
- Crear `src/config/config.ts` — carga, valida, y expone config tipada
- Crear `src/config/schema.ts` — schema Zod del config
- Crear `config/orbit.yaml` — config por defecto
- Migrar: `GEMINI_API_KEY` y demas vars → `orbit.yaml`

### 0.3 — Logger Estructurado
**Que:** Reemplazar `console.log/error/warn` con logger con niveles y contexto.
**Donde:** `src/infra/logger.ts` (nuevo)
**Por que:** OpenClaw tiene diagnostic events. Orbit necesita observabilidad minima.
**Archivos:**
- Crear `src/infra/logger.ts` — wrapper sobre console con niveles (debug/info/warn/error)
- Migrar progresivamente los `console.log` en archivos tocados

---

## FASE 1 — SISTEMA DE TOOLS TIPADO (Semana 1-2)
> El corazon de OpenClaw. Orbit pasa de string dispatch a un registro tipado.

### 1.1 — Tool Registry Tipado
**Que:** Cada tool se registra con metadata completa: schema, capabilities, permisos.
**Donde:** Reescribir `src/core/tool-registry.ts`
**Patron OpenClaw:** `tool-catalog.ts` con profiles, sections, groups.

```typescript
// Nuevo formato de registro (inspirado en OpenClaw)
interface OrbitTool {
  id: string;                    // "browser_control"
  section: ToolSection;          // "web" | "system" | "ai" | "files" | "comms"
  profiles: ToolProfile[];       // ["full", "coding"]
  description: string;
  parameters: ZodSchema;         // validacion Zod
  handler: (params: any) => Promise<string>;
  capabilities?: {
    requiresUI?: boolean;
    requiresNetwork?: boolean;
    destructive?: boolean;
    async?: boolean;
  };
}
```

**Archivos:**
- Reescribir `src/core/tool-registry.ts` — nuevo ToolRegistry class
- Modificar `src/actions/index.ts` — `executeTool` usa el registry en vez de switch
- Cada action file exporta su tool definition (no solo la funcion)

### 1.2 — Tool Profiles
**Que:** Categorizar tools en perfiles (minimal/standard/full/coding).
**Por que:** Subagentes solo necesitan subset de tools. Seguridad.
**Archivos:**
- Agregar en `src/core/tool-registry.ts`: `getToolsForProfile(profile)`
- Usar en `src/agent/executor.ts` para limitar tools disponibles por contexto

### 1.3 — Tool Policy System
**Que:** Politicas de permiso por tool: allow/deny lists, por agente y por contexto.
**Patron OpenClaw:** `pi-tools.policy.ts`
**Archivos:**
- Crear `src/core/tool-policy.ts` — resolucion de politicas
- Integrar en `executeTool()` — verificar politica antes de ejecutar

---

## FASE 2 — MULTI-PROVEEDOR LLM (Semana 2-3)
> Orbit deja de depender exclusivamente de Gemini.

### 2.1 — Provider Abstraction Layer
**Que:** Interfaz comun para cualquier proveedor LLM (Gemini, OpenAI, Anthropic, Ollama).
**Patron OpenClaw:** `models-config.ts` + provider capability introspection.

```typescript
interface LLMProvider {
  id: string;                    // "gemini" | "openai" | "anthropic" | "ollama"
  name: string;
  models: ModelConfig[];
  capabilities: ProviderCapabilities;
  generateContent(params: GenerateParams): Promise<GenerateResult>;
  generateStream?(params: GenerateParams): AsyncIterable<StreamChunk>;
}

interface ModelConfig {
  id: string;                    // "gemini-2.5-flash-lite"
  contextWindow: number;         // 1_000_000
  supportsTools: boolean;
  supportsVision: boolean;
  supportsAudio: boolean;
  costPer1kTokens?: { input: number; output: number };
}
```

**Archivos:**
- Crear `src/providers/` (nuevo directorio)
- Crear `src/providers/types.ts` — interfaces
- Crear `src/providers/gemini.ts` — adapter actual (extraer de index.ts)
- Crear `src/providers/openai.ts` — adapter OpenAI
- Crear `src/providers/anthropic.ts` — adapter Anthropic
- Crear `src/providers/ollama.ts` — adapter local Ollama
- Crear `src/providers/registry.ts` — registro de providers

### 2.2 — Model Fallback System
**Que:** Si el modelo principal falla (rate limit, error), intentar automaticamente con otro.
**Patron OpenClaw:** Ranked auth profiles con retry automatico.

```typescript
// Cadena de fallback configurable
const fallbackChain = [
  { provider: "gemini", model: "gemini-2.5-flash-native-audio-latest" },  // primario (voz)
  { provider: "gemini", model: "gemini-2.5-flash" },                       // sin audio
  { provider: "openai", model: "gpt-4o" },                                  // fallback 1
  { provider: "ollama", model: "llama3" },                                   // local offline
];
```

**Archivos:**
- Crear `src/providers/fallback.ts` — logica de failover
- Modificar `src/index.ts` — usar fallback al conectar
- Modificar `src/agent/planner.ts` — usar provider pool en vez de hardcoded

### 2.3 — Tool Schema Adaptation
**Que:** Convertir tool declarations al formato de cada proveedor automaticamente.
**Patron OpenClaw:** `tool-split.ts` + provider-capabilities detection.
**Archivos:**
- Crear `src/providers/tool-adapter.ts` — convierte OrbitTool[] a formato OpenAI/Gemini/Claude

---

## FASE 3 — SISTEMA DE PLUGINS (Semana 3-4)
> Orbit se vuelve extensible sin modificar el core.

### 3.1 — Plugin SDK
**Que:** Interfaz que cualquier plugin debe implementar.
**Patron OpenClaw:** `plugin-sdk/` con tipos publicos y factory functions.

```typescript
interface OrbitPlugin {
  id: string;
  name: string;
  version: string;
  type: "tool" | "channel" | "provider" | "skill";
  setup(): Promise<void>;
  teardown?(): Promise<void>;
}

interface OrbitToolPlugin extends OrbitPlugin {
  type: "tool";
  tools: OrbitTool[];        // registra N tools
}

interface OrbitChannelPlugin extends OrbitPlugin {
  type: "channel";
  onMessage(msg: InboundMessage): Promise<void>;
  sendMessage(msg: OutboundMessage): Promise<void>;
}
```

**Archivos:**
- Crear `src/plugins/` (nuevo directorio)
- Crear `src/plugins/types.ts` — interfaces de plugin
- Crear `src/plugins/loader.ts` — carga plugins desde `plugins/` dir
- Crear `src/plugins/registry.ts` — registro global de plugins

### 3.2 — Migrar Tools Existentes a Plugins
**Que:** Cada grupo de tools se convierte en un plugin interno.
**Archivos:**
- `src/actions/browser-control.ts` → Plugin "browser"
- `src/actions/computer-control.ts` + `ps-bridge.ts` → Plugin "computer"
- `src/actions/web-search.ts` → Plugin "web"
- `src/actions/file-controller.ts` → Plugin "files"
- `src/actions/send-message.ts` → Plugin "messaging"
- `src/actions/code-helper.ts` → Plugin "coding"
- `src/actions/reminder.ts` → Plugin "scheduler"

### 3.3 — Plugin Discovery
**Que:** Auto-descubrir plugins en `~/.orbit/plugins/` y `./plugins/`.
**Archivos:**
- Modificar `src/plugins/loader.ts` — escanear directorios
- Modificar `src/index.ts` — cargar plugins al inicio

---

## FASE 4 — SUBAGENTES Y EJECUCION AVANZADA (Semana 4-5)
> Orbit puede delegar sub-tareas a agentes especializados.

### 4.1 — Subagent Registry
**Que:** Crear, monitorear, y terminar subagentes con aislamiento de contexto.
**Patron OpenClaw:** `subagent-registry/` con lifecycle management.

```typescript
interface SubagentConfig {
  id: string;
  goal: string;
  parentSessionKey: string;
  toolProfile: ToolProfile;       // subset de tools permitidos
  model?: string;                  // puede usar modelo diferente
  maxSteps?: number;
  timeout?: number;
  sandbox?: boolean;
}
```

**Archivos:**
- Crear `src/agent/subagent-registry.ts` — registro CRUD de subagentes
- Modificar `src/agent/executor.ts` — poder spawn subagentes desde un step
- Modificar `src/core/tool-registry.ts` — agregar tool `spawn_subagent`

### 4.2 — Execution Lanes (Concurrencia)
**Que:** Limitar ejecuciones paralelas. Prevenir callback storms.
**Patron OpenClaw:** `lanes.ts` con semaforos globales y por-sesion.
**Archivos:**
- Crear `src/agent/lanes.ts` — semaforo global + por sesion
- Integrar en `src/agent/task-queue.ts` — respetar lanes

### 4.3 — Parallel Step Execution
**Que:** Detectar steps independientes en un plan y ejecutarlos en paralelo.
**Archivos:**
- Modificar `src/agent/planner.ts` — agregar campo `dependsOn: number[]` a steps
- Modificar `src/agent/executor.ts` — ejecutar grupos de steps sin dependencias en paralelo

---

## FASE 5 — CONTEXTO Y MEMORIA AVANZADA (Semana 5-6)
> OpenClaw-grade context management.

### 5.1 — Context Compaction
**Que:** Cuando la ventana de contexto se llena, resumir automaticamente en vez de truncar.
**Patron OpenClaw:** `compact.ts` con token budget + safety timeout.

```typescript
interface CompactionConfig {
  triggerThreshold: number;      // 0.85 (85% del contexto lleno)
  model: string;                  // modelo barato para resumir
  maxAttempts: number;
  timeoutMs: number;
  preserveLastN: number;         // mantener ultimos N mensajes intactos
}
```

**Archivos:**
- Crear `src/memory/compaction.ts` — logica de compactacion
- Modificar `src/index.ts` — trigger compaction cuando se acerque al limite
- Modificar `src/memory/chat-history.ts` — marcar mensajes como "compacted"

### 5.2 — Context Engine Interface
**Que:** Abstraccion para que diferentes estrategias de memoria sean pluggables.
**Patron OpenClaw:** `context-engine/` con interfaz ContextEngine.
**Archivos:**
- Crear `src/memory/context-engine.ts` — interfaz abstracta
- Crear `src/memory/engines/default.ts` — implementacion actual
- Futuro: engine con embeddings, engine con RAG, etc.

### 5.3 — Session Persistence
**Que:** Guardar sesiones completas a disco para resume after restart.
**Patron OpenClaw:** `sessions/` con JSONL transcripts.
**Archivos:**
- Crear `src/memory/session-store.ts` — guardar/cargar sesiones Gemini Live
- Modificar `src/index.ts` — restaurar sesion previa al reconectar

### 5.4 — Memory Search
**Que:** Busqueda semantica en memoria del usuario (no solo lectura plana).
**Archivos:**
- Modificar `src/memory/memory-manager.ts` — agregar `searchMemory(query)`
- Usar LLM para matching semantico (barato, flash-lite)

---

## FASE 6 — SEGURIDAD Y APROBACIONES (Semana 6-7)
> Patron critico de OpenClaw: no ejecutar nada peligroso sin aprobacion.

### 6.1 — Command Approval System
**Que:** Antes de ejecutar comandos shell, pedir aprobacion al usuario.
**Patron OpenClaw:** `exec-approvals.ts` con allowlist + socket + timeout.

```typescript
type ApprovalPolicy = {
  security: "deny" | "allowlist" | "full";
  ask: "off" | "on-miss" | "always";
  allowlist: { pattern: string; lastUsed?: number }[];
  safeBins: string[];            // ["git", "npm", "node", "python"]
};
```

**Archivos:**
- Crear `src/security/` (nuevo directorio)
- Crear `src/security/exec-approval.ts` — logica de aprobacion
- Crear `src/security/safe-bins.ts` — lista de comandos seguros
- Modificar `src/actions/cmd-control.ts` — verificar aprobacion antes de exec
- Modificar gateway — enviar approval requests a UI, recibir respuesta

### 6.2 — Tool Permission UI
**Que:** La Web UI muestra popup de aprobacion cuando Orbit quiere ejecutar algo peligroso.
**Archivos:**
- Modificar `src/ui/web/index.html` — agregar modal de aprobacion
- Modificar `src/gateway/server.ts` — nuevo message type "approval_request"/"approval_response"

### 6.3 — File System Boundaries
**Que:** Restringir acceso a archivos solo dentro de workspaces configurados.
**Patron OpenClaw:** Workspace root guards + path traversal prevention.
**Archivos:**
- Crear `src/security/fs-boundary.ts` — validar paths antes de operar
- Modificar `src/actions/file-controller.ts` — usar boundary check

---

## FASE 7 — BROWSER AUTOMATION PRO (Semana 7-8)
> Upgrade del browser control al nivel de OpenClaw.

### 7.1 — Browser Lifecycle Management
**Que:** Start/stop browser instances, profile management, session persistence.
**Patron OpenClaw:** `extensions/browser/` con core-api + profiles.
**Archivos:**
- Reescribir `src/actions/browser-control.ts` con:
  - Browser pool (multiples instancias)
  - Profile support (shared vs isolated)
  - Tab management (open, close, list, focus)
  - Session persistence (cookies, localStorage)

### 7.2 — DOM Snapshot (Accessibility Tree)
**Que:** Capturar DOM como arbol de accesibilidad para que el LLM entienda la pagina.
**Patron OpenClaw:** `browserSnapshot()` — DOM tree con node IDs.
**Archivos:**
- Crear `src/actions/browser-snapshot.ts` — captura accessibility tree
- Agregar como tool: `browser_snapshot`

### 7.3 — Smart Element Selection
**Que:** Resolver elementos por CSS, XPath, o descripcion natural.
**Archivos:**
- Modificar `src/actions/browser-control.ts` — agregar node ID resolution
- Combinar con vision: si CSS falla, usar screenshot + Gemini Vision

---

## FASE 8 — CANALES DE MENSAJERIA (Semana 8-9)
> Orbit se conecta a multiples plataformas como OpenClaw.

### 8.1 — Channel Plugin Interface
**Que:** Interfaz estandar para recibir/enviar mensajes en cualquier plataforma.

```typescript
interface ChannelPlugin {
  id: string;                          // "whatsapp" | "telegram" | "discord"
  setup(config: ChannelConfig): Promise<void>;
  onMessage(handler: MessageHandler): void;
  sendMessage(to: string, msg: OutboundMessage): Promise<void>;
  getStatus(): ChannelStatus;
}
```

**Archivos:**
- Crear `src/channels/` (nuevo directorio)
- Crear `src/channels/types.ts` — interfaces
- Crear `src/channels/whatsapp.ts` — migrar de send-message.ts
- Crear `src/channels/telegram.ts` — migrar de send-message.ts
- Crear `src/channels/discord.ts` — nuevo (usando discord.js)

### 8.2 — Message Routing
**Que:** Router que dirige mensajes entrantes al agente correcto.
**Patron OpenClaw:** Session keys como `channel:account:conversation`.
**Archivos:**
- Crear `src/channels/router.ts` — routing por session key
- Modificar `src/gateway/server.ts` — integrar channel router

---

## FASE 9 — SKILLS SYSTEM (Semana 9-10)
> Skills = paquetes de conocimiento + tools instalables.

### 9.1 — Skill Package Format
**Que:** Definir formato de skill (directorio con manifest + tools + prompts).

```
skills/
  github/
    manifest.json          // {name, version, tools, prompts}
    tools.ts               // tool implementations
    SKILL.md               // knowledge base
  spotify/
    manifest.json
    tools.ts
    SKILL.md
```

**Archivos:**
- Crear `src/skills/` (nuevo directorio)
- Crear `src/skills/types.ts` — SkillManifest interface
- Crear `src/skills/loader.ts` — carga skills desde directorio
- Crear `src/skills/registry.ts` — registro global

### 9.2 — Skills Bundled
**Que:** Migrar skills de OpenClaw que apliquen.
**Skills prioritarias:**
- GitHub (issues, PRs, commits)
- Spotify (playback control)
- Weather (ya existe en Orbit, refactorizar)
- Obsidian/Notes (integracion con notas)

### 9.3 — Skill Discovery en System Prompt
**Que:** Inyectar descripciones de skills instalados en el system prompt.
**Patron OpenClaw:** Skills prompt section automatica.
**Archivos:**
- Modificar `src/core/prompt.ts` — agregar seccion de skills disponibles
- Modificar `src/index.ts` — cargar skills al startup

---

## FASE 10 — POLISH Y PRODUCCION (Semana 10-12)

### 10.1 — CLI (Commander.js)
**Que:** CLI para gestionar Orbit sin abrir Electron.
```
orbit start              # inicia el asistente
orbit config             # editar configuracion
orbit plugins list       # ver plugins instalados
orbit skills install X   # instalar skill
orbit models list        # ver modelos configurados
orbit doctor            # diagnosticos
```

### 10.2 — Daemon Mode
**Que:** Orbit corre como servicio del sistema (Windows Service / systemd).
**Patron OpenClaw:** `daemon.ts` con respawn on crash.

### 10.3 — Health Monitoring
**Que:** Heartbeat, auto-restart de componentes fallidos, metricas basicas.
**Patron OpenClaw:** `heartbeat-*` con presence tracking.

### 10.4 — Config UI
**Que:** Pagina de configuracion en la Web UI para gestionar todo visualmente.

---

## ORDEN DE PRIORIDAD (por impacto)

| # | Fase | Impacto | Riesgo | Esfuerzo |
|---|------|---------|--------|----------|
| 1 | FASE 0 - Infraestructura | Base para todo | Bajo | 2-3 dias |
| 2 | FASE 1 - Tools Tipado | Alto (calidad) | Bajo | 3-4 dias |
| 3 | FASE 2 - Multi-Provider | Critico (resilience) | Medio | 5-7 dias |
| 4 | FASE 5 - Contexto/Memoria | Alto (inteligencia) | Medio | 5-7 dias |
| 5 | FASE 6 - Seguridad | Critico (safety) | Bajo | 3-5 dias |
| 6 | FASE 4 - Subagentes | Alto (capacidad) | Medio | 5-7 dias |
| 7 | FASE 3 - Plugins | Alto (extensibilidad) | Medio | 5-7 dias |
| 8 | FASE 7 - Browser Pro | Medio | Medio | 5-7 dias |
| 9 | FASE 8 - Canales | Medio (alcance) | Alto | 7-10 dias |
| 10 | FASE 9 - Skills | Medio | Bajo | 5-7 dias |
| 11 | FASE 10 - Production | Alto (estabilidad) | Bajo | 7-10 dias |

---

## DEPENDENCIAS ENTRE FASES

```
FASE 0 (Infraestructura)
  └─> FASE 1 (Tools Tipado)
       ├─> FASE 2 (Multi-Provider)
       ├─> FASE 3 (Plugins)
       │    └─> FASE 8 (Canales)
       │    └─> FASE 9 (Skills)
       ├─> FASE 4 (Subagentes)
       └─> FASE 6 (Seguridad)
            └─> FASE 7 (Browser Pro)

  └─> FASE 5 (Contexto/Memoria) [independiente]

  FASE 10 (Production) [requiere FASE 1-6 minimo]
```

---

## ARCHIVOS DE OPENCLAW A ESTUDIAR POR FASE

### FASE 0
- `openclaw-main/src/config/config.ts` — patron de config
- `openclaw-main/packages/zod-config/` — validacion con Zod

### FASE 1
- `openclaw-main/src/agents/tool-catalog.ts` — catalogo de tools
- `openclaw-main/src/agents/pi-tools.policy.ts` — politicas

### FASE 2
- `openclaw-main/src/agents/models-config.ts` — multi-modelo
- `openclaw-main/src/agents/provider-capabilities.ts` — capabilities

### FASE 3
- `openclaw-main/src/plugin-sdk/` — SDK completo
- `openclaw-main/extensions/` — ejemplos de plugins

### FASE 4
- `openclaw-main/src/agents/subagent-registry/` — registro
- `openclaw-main/src/agents/pi-embedded-runner/lanes.ts` — lanes

### FASE 5
- `openclaw-main/src/context-engine/` — motor de contexto
- `openclaw-main/src/agents/pi-embedded-runner/compact.ts` — compactacion

### FASE 6
- `openclaw-main/src/infra/exec-approvals.ts` — aprobaciones
- `openclaw-main/src/agents/bash-tools.ts` — safe bins

### FASE 7
- `openclaw-main/extensions/browser/` — browser completo

### FASE 8
- `openclaw-main/src/channels/` — canales core
- `openclaw-main/src/routing/` — routing

### FASE 9
- `openclaw-main/skills/` — skills bundled

---

## ESTRUCTURA FINAL DE ORBIT (post-integracion)

```
src/
  index.ts                     # Entry point (simplificado)
  config/
    config.ts                  # Config centralizada
    schema.ts                  # Zod schemas
  infra/
    logger.ts                  # Logger estructurado
  core/
    tool-registry.ts           # Registry tipado con profiles
    tool-policy.ts             # Politicas de permisos
    prompt.ts                  # System prompt compositor
    voice.ts                   # Gemini Live client
  providers/
    types.ts                   # LLMProvider interface
    registry.ts                # Provider registry + fallback
    gemini.ts                  # Gemini adapter
    openai.ts                  # OpenAI adapter
    anthropic.ts               # Anthropic adapter
    ollama.ts                  # Ollama local adapter
    tool-adapter.ts            # Schema conversion
  agent/
    planner.ts                 # Planning con dependencias
    executor.ts                # Execution con parallelism
    error-handler.ts           # Error analysis
    task-queue.ts              # Task queue con lanes
    subagent-registry.ts       # Subagent lifecycle
    lanes.ts                   # Concurrency control
  memory/
    memory-manager.ts          # Memory CRUD + search
    chat-history.ts            # SQLite history
    compaction.ts              # Context compaction
    context-engine.ts          # Engine interface
    session-store.ts           # Session persistence
  security/
    exec-approval.ts           # Command approval
    safe-bins.ts               # Safe command list
    fs-boundary.ts             # Filesystem boundaries
  plugins/
    types.ts                   # Plugin interfaces
    loader.ts                  # Auto-discovery
    registry.ts                # Plugin registry
  channels/
    types.ts                   # Channel interface
    router.ts                  # Message routing
    whatsapp.ts
    telegram.ts
    discord.ts
  skills/
    types.ts                   # Skill manifest
    loader.ts                  # Skill discovery
    registry.ts                # Skill registry
  actions/                     # (se convierte en plugins internos)
    browser-control.ts
    computer-control.ts
    ps-bridge.ts
    screen-interaction.ts
    file-controller.ts
    cmd-control.ts
    web-search.ts
    code-helper.ts
    ...
  gateway/
    server.ts                  # WebSocket + approval flow
  ui/
    web-server.ts
    web/
    overlay/
  types/
    schemas.ts                 # Zod schemas globales
```

---

## NOTAS IMPORTANTES

1. **NO romper el audio bidireccional.** La sesion Gemini Live es el diferenciador de Orbit.
   Toda integracion debe mantener `gemini-2.5-flash-native-audio-latest` como primario.

2. **NO copiar OpenClaw linea por linea.** Adaptar PATRONES, no codigo.
   OpenClaw es 150k+ lineas. Orbit debe ser lean (~5-10k lineas).

3. **Cada fase es deployable.** Despues de cada fase, Orbit debe compilar y funcionar.

4. **Tests por fase.** Agregar al menos smoke tests para cada modulo nuevo.

5. **El Python sidecar se mantiene.** YOLO Vision engine sigue siendo sidecar.
   No intentar integrar en Node/TS.

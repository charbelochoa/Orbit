# ORBIT CODE — Plan de Implementación Competitivo
> Análisis exhaustivo de Claude Code (fuente filtrada 2026-03-31) para construir un competidor superior

---

## 1. ESTRUCTURA DE ARCHIVOS DE CLAUDE CODE

```
claude-code-main/
├── src/
│   ├── entrypoints/
│   │   ├── cli.tsx              ← Punto de entrada CLI principal
│   │   ├── init.ts              ← Init de config, telemetría, OAuth, MDM
│   │   ├── mcp.ts               ← Modo servidor MCP
│   │   └── sdk/                 ← API programática para embeber Claude Code
│   ├── screens/
│   │   ├── REPL.tsx             ← Pantalla principal (~46K líneas de imports/orchestration)
│   │   ├── Doctor.tsx           ← Diagnósticos (/doctor)
│   │   └── ResumeConversation.tsx
│   ├── QueryEngine.ts           ← Motor LLM central (~46K líneas)
│   ├── Tool.ts                  ← Base class para todas las herramientas (~29K líneas)
│   ├── commands.ts              ← Registro de comandos slash (~25K líneas)
│   ├── tools.ts                 ← Registro de herramientas
│   ├── context.ts               ← Recolección de contexto del sistema
│   ├── main.tsx                 ← CLI parser (Commander.js)
│   ├── tools/                   ← ~40 herramientas en subdirectorios
│   ├── commands/                ← ~85 comandos slash
│   ├── components/              ← ~140 componentes React/Ink
│   ├── hooks/                   ← ~80 React hooks
│   ├── services/                ← Servicios externos (API, MCP, analytics, OAuth)
│   ├── state/                   ← Estado global (AppStateStore)
│   ├── keybindings/             ← Sistema de keybindings customizable
│   ├── memdir/                  ← Sistema de memoria persistente
│   ├── schemas/                 ← Zod v4 schemas de configuración
│   ├── skills/                  ← Sistema de skills (16 bundled)
│   ├── tasks/                   ← Tasks en background (LocalShell, Agent, Remote)
│   ├── coordinator/             ← Multi-agent coordinator
│   ├── bridge/                  ← IDE bridge (VS Code, JetBrains)
│   ├── voice/                   ← Input/output de voz
│   ├── plugins/                 ← Sistema de plugins
│   └── vim/                     ← Modo vim
├── docs/
│   ├── architecture.md
│   ├── tools.md
│   ├── commands.md
│   ├── subsystems.md
│   └── exploration-guide.md
└── package.json                 ← Runtime: Bun (no Node.js)
```

---

## 2. CARACTERÍSTICAS PRINCIPALES

### 2A. COMANDOS SLASH (100+ comandos)

**Git & Control de Versiones:**
| Comando | Descripción |
|---------|-------------|
| `/commit` | Commit con mensaje generado por IA |
| `/commit-push-pr` | Commit + push + PR en un solo paso |
| `/branch` | Crear/cambiar branches |
| `/diff` | Ver cambios (staged, unstaged, vs ref) |
| `/pr_comments` | Ver y resolver comentarios de PR |
| `/rewind` | Revertir a estado anterior |

**Calidad de Código:**
| Comando | Descripción |
|---------|-------------|
| `/review` | Code review con IA |
| `/security-review` | Code review enfocado en seguridad |
| `/advisor` | Consejo de arquitectura o diseño |
| `/bughunter` | Encontrar bugs potenciales |

**Sesión y Contexto:**
| Comando | Descripción |
|---------|-------------|
| `/compact` | Comprimir historial para mantener más contexto |
| `/context` | Visualizar contexto actual (archivos, memoria, tokens) |
| `/resume` | Restaurar sesión anterior |
| `/session` | Gestionar sesiones (listar/cambiar/borrar) |
| `/share` | Compartir sesión via link |
| `/export` | Exportar conversación a archivo |
| `/summary` | Generar resumen de la sesión |
| `/clear` | Limpiar historial |

**Configuración:**
| Comando | Descripción |
|---------|-------------|
| `/config` | Ver/modificar settings (abre Settings UI completo) |
| `/permissions` | Gestionar reglas de permisos de herramientas |
| `/theme` | Cambiar tema de color del terminal |
| `/output-style` | Cambiar formato de output |
| `/keybindings` | Ver/customizar keybindings |
| `/vim` | Activar modo vim para input |
| `/effort` | Ajustar nivel de esfuerzo en respuestas |
| `/model` | Cambiar modelo activo |
| `/fast` | Activar modo rápido (respuestas cortas) |
| `/brief` | Toggle output resumido |

**Memoria y Conocimiento:**
| Comando | Descripción |
|---------|-------------|
| `/memory` | Gestionar memoria persistente (CLAUDE.md files) |
| `/add-dir` | Añadir directorio al contexto del proyecto |
| `/files` | Listar archivos en el contexto actual |

**MCP y Plugins:**
| Comando | Descripción |
|---------|-------------|
| `/mcp` | Gestionar conexiones MCP |
| `/plugin` | Instalar/remover/gestionar plugins |
| `/reload-plugins` | Recargar todos los plugins |
| `/skills` | Ver y gestionar skills |

**Tareas y Agentes:**
| Comando | Descripción |
|---------|-------------|
| `/tasks` | Gestionar tareas en background |
| `/agents` | Gestionar sub-agentes |
| `/ultraplan` | Generar plan de ejecución detallado |
| `/plan` | Entrar en modo planning (sin ejecutar) |

**Diagnósticos:**
| Comando | Descripción |
|---------|-------------|
| `/doctor` | Diagnósticos de entorno |
| `/status` | Estado del sistema y sesión |
| `/stats` | Estadísticas de la sesión |
| `/cost` | Uso de tokens y costo estimado |
| `/version` | Versión de Claude Code |

**Especiales / Easter Eggs:**
- `/stickers` — Easter egg con stickers
- `/good-claude` — Alabar a Claude
- `/thinkback` — Replay del proceso de pensamiento
- `/thinkback-play` — Replay animado del pensamiento
- `/ultraplan` — Plan ultra-detallado de ejecución
- `/x402` — Integración con protocolo de pagos x402

### 2B. MODOS DE OPERACIÓN CLI

```bash
claude                          # REPL interactivo
claude "pregunta"               # Print mode (no interactivo, --print implícito)
claude -p "pregunta"            # --print: no-interactivo, solo output
claude --continue               # Continuar última sesión
claude --resume <session-id>    # Restaurar sesión específica
claude --model claude-opus-4-5  # Especificar modelo
claude -v / --version           # Versión
claude remote-control           # Modo bridge para IDE (alias: rc, remote, sync, bridge)
claude --daemon-worker=<kind>   # Worker interno del daemon
claude --claude-in-chrome-mcp   # Servidor MCP para integración Chrome
claude --chrome-native-host     # Native host para extensión Chrome
claude --computer-use-mcp       # MCP para computer use
claude --dump-system-prompt     # Debug: imprimir system prompt
```

**Variables de entorno relevantes:**
```bash
CLAUDE_CODE_REMOTE=true         # Modo remoto/container
CLAUDE_CODE_SIMPLE=1            # Modo bare/simple (--bare)
CLAUDE_CODE_DISABLE_THINKING=1  # Deshabilitar extended thinking
DISABLE_AUTO_COMPACT=1          # Deshabilitar compactación automática
CLAUDE_CODE_DISABLE_AUTO_MEMORY=1  # Deshabilitar memoria automática
DISABLE_BACKGROUND_TASKS=1      # Deshabilitar tareas en background
CLAUDE_CODE_ABLATION_BASELINE=1 # Modo ablación (testing)
```

### 2C. SISTEMA DE HERRAMIENTAS (40 herramientas)

**Herramientas de Sistema de Archivos:**
```typescript
FileReadTool     // Lee archivos (texto, imágenes, PDFs, notebooks). Soporta line ranges
FileWriteTool    // Crea o sobreescribe archivos
FileEditTool     // Edición parcial via string replacement — HERRAMIENTA CRÍTICA
GlobTool         // Busca archivos por patrón glob (**/*.ts)
GrepTool         // Búsqueda de contenido con ripgrep (regex)
NotebookEditTool // Editar celdas de Jupyter notebook
TodoWriteTool    // Escribir en archivo de tareas estructurado
```

**Herramientas de Shell:**
```typescript
BashTool         // Ejecutar comandos shell en bash
PowerShellTool   // Ejecutar PowerShell (Windows)
REPLTool         // REPL de código (Python, Node, etc.)
```

**Herramientas de Agente y Orquestación:**
```typescript
AgentTool        // Lanzar sub-agente para tareas complejas
SendMessageTool  // Comunicación entre agentes
TeamCreateTool   // Crear equipo de agentes paralelos
TeamDeleteTool   // Eliminar agente del equipo
EnterPlanModeTool  // Cambiar a modo planeación (sin ejecutar)
ExitPlanModeTool   // Salir de modo planeación
EnterWorktreeTool  // Aislar trabajo en git worktree
ExitWorktreeTool   // Salir de worktree
SleepTool        // Pausar ejecución (modo proactivo)
SyntheticOutputTool // Generar output estructurado
```

**Herramientas de Tareas:**
```typescript
TaskCreateTool   // Crear tarea en background
TaskUpdateTool   // Actualizar estado/detalles de tarea
TaskGetTool      // Obtener detalles de tarea
TaskListTool     // Listar todas las tareas
TaskOutputTool   // Obtener output de tarea completada
TaskStopTool     // Detener tarea en ejecución
```

**Herramientas Web:**
```typescript
WebFetchTool     // Obtener contenido de URL
WebSearchTool    // Buscar en internet
```

**Herramientas MCP:**
```typescript
MCPTool               // Invocar herramientas en servidores MCP conectados
ListMcpResourcesTool  // Listar recursos MCP disponibles
ReadMcpResourceTool   // Leer recurso MCP específico
McpAuthTool           // Autenticar con servidor MCP
ToolSearchTool        // Descubrir herramientas deferred/dinámicas
```

**Herramientas de Integración:**
```typescript
LSPTool          // Language Server Protocol (go-to-definition, find-refs)
SkillTool        // Ejecutar un skill registrado
AskUserQuestionTool // Solicitar input al usuario durante ejecución
BriefTool        // Generar resumen/brief
ConfigTool       // Leer/modificar configuración
ScheduleCronTool // Crear trigger cron programado
RemoteTriggerTool // Lanzar trigger remoto
```

**Patrón de definición de herramienta:**
```typescript
export const MyTool = buildTool({
  name: 'MyTool',
  aliases: ['my_tool'],
  description: 'What this tool does',
  searchHint: 'texto para búsqueda semántica de herramienta',
  maxResultSizeChars: 100_000,
  strict: true,
  inputSchema: z.object({ param: z.string() }),
  async description() { return 'Dynamic description' },
  async prompt() { return getToolDescription() },      // Contribución al system prompt
  userFacingName,                                       // Nombre para mostrar al usuario
  getToolUseSummary(input) { return '...' },            // Resumen de 1 línea
  getActivityDescription(input) { return '...' },       // Descripción para status
  async call(args, context, canUseTool, parentMsg, onProgress) { ... },
  async checkPermissions(input, context) { ... },
  isConcurrencySafe(input) { return false },            // ¿Puede correr en paralelo?
  isReadOnly(input) { return false },                   // ¿Es no-destructivo?
  renderToolUseMessage(input, options) { ... },         // UI para invocación
  renderToolResultMessage(content, progress, options) { ... }, // UI para resultado
})
```

### 2D. SISTEMA DE MEMORIA Y CONTEXTO

**Jerarquía de archivos CLAUDE.md:**
```
~/.claude/CLAUDE.md              ← Memoria personal cross-proyecto
~/.claude/CLAUDE.local.md        ← Preferencias privadas locales (gitignored)
{proyecto}/CLAUDE.md             ← Memoria del proyecto (en git)
{proyecto}/CLAUDE.local.md       ← Overrides locales privados
@{ruta/al/archivo}               ← Import de otros archivos de memoria
```

**Tipos de memoria (4 tipos formales):**
```typescript
type MemoryType = 'user' | 'feedback' | 'project' | 'reference'
// user:     Sobre el usuario (rol, preferencias, expertise)
// feedback: Correcciones y confirmaciones del usuario al agente
// project:  Contexto de trabajo en curso (quién hace qué, plazos)
// reference: Información de referencia estática
```

**Sistema memdir (auto-memoria extraída):**
- Ubicación: `~/.claude/memdir/` (privada) + `{proyecto}/.claude/memdir/` (compartida/team)
- Auto-extracción de memorias al final de cada turno (background agent)
- Búsqueda de memorias relevantes por contexto (`findRelevantMemories.ts`)
- Auto-sueño / autoDream: proceso de "sueño" que consolida memorias
- Team memory sync: sincronización de memorias de equipo
- Controlado por `isAutoMemoryEnabled()` (env var o setting)

**Compactación automática de contexto:**
- Se activa cuando el contexto supera ~85% del context window
- Usa un agente sub-compacto que resume la conversación
- El boundary compacto aparece como mensaje especial en el transcripto
- Sistema `contextCollapse` (feature flag): colapsa spans de contexto
- Micro-compact: compactación más granular de secciones individuales

### 2E. SISTEMA DE PERMISOS

**4 modos de permisos:**
```typescript
type PermissionMode = 
  | 'default'          // Pregunta al usuario para ops destructivas
  | 'plan'             // Muestra plan completo, aprueba todo de una vez
  | 'bypassPermissions' // Auto-aprueba todo (peligroso)
  | 'auto'             // Clasificador ML decide automáticamente
```

**Reglas wildcard para permisos:**
```
Bash(git *)           # Permitir todos los comandos git
Bash(npm test)        # Permitir 'npm test' específicamente
FileEdit(/src/*)      # Permitir edits bajo src/
FileRead(*)           # Permitir leer cualquier archivo
Bash(rm -rf *)        # NEGAR (prefijo ! para deny)
```

**Cada herramienta implementa:**
```typescript
async checkPermissions(input, context): Promise<PermissionDecision> {
  return { 
    granted: boolean, 
    reason?: string, 
    prompt?: string  // Texto a mostrar al usuario
  }
}
```

**Hooks de permisos:**
- `PreToolUse`: corre antes de ejecutar herramienta
- `PostToolUse`: corre después de ejecutar herramienta
- Los hooks pueden aprobar/rechazar automáticamente con código de salida
- Los hooks pueden ser comandos bash o prompts LLM

### 2F. MULTI-AGENT / SUBAGENTS

**AgentTool:** Lanza sub-agentes para subtareas complejas
- Cada agente tiene su propio color (para identificación visual)
- Stack de agentes: agente principal puede lanzar sub-agentes anidados
- `InProcessTeammateTask`: agente en el mismo proceso (más rápido)
- `LocalAgentTask`: agente como proceso separado local
- `RemoteAgentTask`: agente en máquina remota
- `DreamTask`: proceso de "sueño" en background

**TeamCreateTool:** Crea equipos de agentes paralelos
- Los agentes se comunican via `SendMessageTool`
- Swarm mode: múltiples agentes trabajando en paralelo
- Leader/worker pattern: el líder coordina workers
- Permiso del líder: los workers envían requests de permiso al líder

**CoordinatorMode (feature flag COORDINATOR_MODE):**
- Orquesta múltiples agentes en paralelo
- `src/coordinator/coordinatorMode.ts`
- Visible en UI con `CoordinatorAgentStatus.tsx`

**Worktrees (feature flag WORKTREE):**
- `EnterWorktreeTool` / `ExitWorktreeTool`
- Aísla cambios en un git worktree separado
- Los agentes pueden trabajar en branches paralelas independientemente

### 2G. STREAMING OUTPUT

**Pipeline de streaming:**
```
API stream → handleMessageFromStream() → React state → renderizado en terminal
```

**El QueryEngine maneja:**
- Streaming de tokens en tiempo real
- Tool-call loops: LLM → herramienta → LLM (ciclos)
- Extended thinking con presupuesto de tokens
- Token counting por turno
- Retry automático con backoff
- Context window management

**Componentes de UI durante streaming:**
- `SpinnerWithVerb` — spinner animado con verbo de actividad
- `SpinnerAnimationRow` — animación a 50ms (useAnimationFrame)
- `GlimmerMessage` — efecto shimmer durante carga
- `BashModeProgress` — progreso de ejecución bash
- "Stall detection" — detecta cuando el agente se queda atascado y cambia color

### 2H. DIFF / PATCH RENDERING

**Sistema de diff con sintaxis:**
```typescript
// StructuredDiff.tsx — usa módulo NAPI de Rust para colores
// ColorDiff: módulo nativo (Rust/NAPI) que renderiza diffs con sintaxis
// Soporta detectar lenguaje por extensión de archivo
// Cache de renders con WeakMap para evitar re-renders en remount
// Separación de gutter (números de línea) y contenido

// Patrón: + líneas adiciones en verde, - eliminaciones en rojo
// Numeración de líneas: old line number + new line number
```

**FileEditToolDiff.tsx** — muestra diff para cada edición de archivo:
- Preview de la edición antes de aplicarla (en modo plan)
- Diff completo después de aplicarla
- Indicador de líneas añadidas/eliminadas

**StructuredDiffList.tsx** — lista de diffs para cambios múltiples

### 2I. SYNTAX HIGHLIGHTING

```typescript
// HighlightedCode.tsx — usa módulo nativo (ColorFile)
// ColorFile: módulo NAPI de Rust para coloreado de código
// Detección de lenguaje por: extensión de archivo + shebang line
// Cache de renders a nivel de módulo (WeakMap)
// Soporte para deshabilitar: settings.syntaxHighlightingDisabled
// Configuración de tema: useTheme() — 'dark', 'light', etc.
```

### 2J. CONTEXT WINDOW TRACKING

```typescript
// calculateTokenWarningState() — determina nivel de advertencia
// getEffectiveContextWindowSize() — size real según modelo activo
// calculateContextPercentages() — porcentajes used/remaining
// doesMostRecentAssistantMessageExceed200k() — advertencia especial

// Visualización: TokenWarning.tsx
// Niveles: normal → warning (amarillo) → critical (rojo)
// Auto-compact se activa al ~85% del context window

// StatusLine muestra: 
// - tokens usados / tamaño del context window
// - porcentaje disponible
// - indicator cuando supera 200k tokens
```

### 2K. CONFIGURACIÓN

**Archivos de configuración:**
```
~/.claude/settings.json          ← Config global del usuario
~/.claude/settings.local.json    ← Config local (no sincronizada)
{proyecto}/.claude/settings.json ← Config del proyecto (en git)
{proyecto}/.claude/settings.local.json ← Overrides locales
```

**Niveles de config (precedencia):**
```
Managed (Enterprise MDM) > User > Project > Built-in defaults
```

**Settings disponibles:**
```typescript
interface Settings {
  // Modelos
  model?: string                    // Modelo principal
  smallFastModel?: string           // Modelo rápido para tareas pequeñas
  
  // Permisos
  permissions?: {
    allow: string[]                 // Reglas wildcard de allow
    deny: string[]                  // Reglas wildcard de deny
    additionalDirectories: string[] // Dirs adicionales accesibles
  }
  
  // Comportamiento
  outputStyle?: string              // Estilo de output
  syntaxHighlightingDisabled?: boolean
  autoMemoryEnabled?: boolean
  
  // MCP
  mcpServers?: Record<string, MCPServerConfig>
  
  // Hooks del sistema
  hooks?: {
    PreToolUse?: HookConfig[]
    PostToolUse?: HookConfig[]
    PreCompact?: HookConfig[]
    UserPromptSubmit?: HookConfig[]
    Stop?: HookConfig[]
    SessionStart?: HookConfig[]
    SessionEnd?: HookConfig[]
    Notification?: HookConfig[]
  }
  
  // StatusLine customizable
  statusLine?: string              // Comando para el status line custom
  
  // Tema y UX
  theme?: string
  colorScheme?: string
  vimModeEnabled?: boolean
}
```

**Hooks disponibles (8 eventos):**
```typescript
type HookEvent = 
  | 'PreToolUse'        // Antes de ejecutar herramienta
  | 'PostToolUse'       // Después de ejecutar herramienta
  | 'PreCompact'        // Antes de compactar contexto
  | 'UserPromptSubmit'  // Cuando el usuario envía mensaje
  | 'Stop'              // Cuando el agente termina
  | 'SessionStart'      // Al iniciar sesión
  | 'SessionEnd'        // Al finalizar sesión
  | 'Notification'      // Cuando se genera notificación

// Tipos de hooks:
// 'command' — Comando shell
// 'prompt'  — Prompt LLM evaluado en contexto
// 'agent'   — Sub-agente completo
```

### 2L. MCP (MODEL CONTEXT PROTOCOL)

**Claude Code como cliente MCP:**
- Enumera herramientas de servidores MCP conectados
- Navegación de recursos MCP
- `ToolSearchTool` descubre herramientas deferred en runtime
- `McpAuthTool` maneja flujos de autenticación
- `useMcpConnectivityStatus` monitorea salud de conexiones

**Claude Code como servidor MCP:**
```bash
claude --mcp   # Expone sus propias herramientas via MCP
              # Permite que otros agentes usen Claude Code como tool server
```

**Configuración de servidores MCP:**
```json
// ~/.claude/settings.json o .mcp.json
{
  "mcpServers": {
    "filesystem": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/path"]
    }
  }
}
```

### 2M. GIT INTEGRATION

**Comandos nativos:**
- `/commit` — IA-generated commit messages
- `/commit-push-pr` — Commit + push + PR automático
- `/branch` — Crear/cambiar branches
- `/diff` — Visualizar cambios git
- `/pr_comments` — Revisar comentarios de PR

**En el sistema de herramientas:**
- `fetchSingleFileGitDiff` — diff de archivo individual
- `trackGitOperations` — seguimiento de operaciones git (en BashTool)
- `fileHistoryTrackEdit` — historial de cambios por archivo
- `fileHistoryRewind` — revertir cambios anteriores

**Git worktrees:**
- `EnterWorktreeTool` / `ExitWorktreeTool`
- Permite agentes trabajando en paralelo en diferentes branches
- Auto-limpieza al salir de la sesión

### 2N. TODO TRACKING

```typescript
// TodoWriteTool — herramienta dedicada para listas de tareas
// Integración nativa con /tasks command
// Ctrl+T — Toggle panel de todos (keybinding global)
// TaskCreateTool, TaskUpdateTool, TaskListTool, etc. para tasks LLM-gestionadas
```

---

## 3. UX DEL CLI — Interfaz en detalle

### 3A. PROMPT DEL USUARIO

```
┌─ Área de input ────────────────────────────────────────────────────────────────┐
│                                                                                  │
│  > [cursor aquí / texto del usuario]                                            │
│                                                                                  │
├─ Footer ───────────────────────────────────────────────────────────────────────┤
│  [StatusLine custom] │ [notificaciones] │ [bridge status]                       │
│  [? for shortcuts]   │ [model: claude-opus-4-5]   │ [tokens: 42k/200k (21%)]   │
└─────────────────────────────────────────────────────────────────────────────────┘
```

**Modos de input:**
- `prompt` — Modo normal de chat
- `bash` — Modo bash con `!` prefix (o shift+tab para ciclar)
- `plan` — Modo plan (no ejecuta, solo planea)
- `vim` — Modo vim para edición de texto

**Keybindings globales:**
```
Ctrl+C (doble)    → Interrumpir / exit (time-based double-press)
Ctrl+D (doble)    → Salir
Ctrl+L            → Redibujar terminal
Ctrl+T            → Toggle panel de todos
Ctrl+O            → Toggle transcripto/historial
Ctrl+R            → Buscar en historial (ctrl+r history search)
Ctrl+Shift+F      → Búsqueda global de archivos
Ctrl+Shift+P      → Quick open (command palette)
Shift+Tab         → Ciclar modo (prompt → bash → plan)
Meta+P            → Model picker
Meta+O            → Fast mode toggle
Meta+T            → Thinking mode toggle
Enter             → Enviar mensaje
Up/Down           → Navegar historial de mensajes
Ctrl+X Ctrl+E     → Abrir mensaje en editor externo (readline style)
Ctrl+G            → Abrir editor externo (alternativo)
Ctrl+S            → Stash (guardar borrador)
Alt+V             → Pegar imagen del portapapeles (Windows, ctrl+v en otros)
Space (hold)      → Push-to-talk voz (modo voz activado)
Shift+Up          → Message actions (seleccionar mensaje)
Ctrl+X Ctrl+K     → Kill agents
```

**El input soporta:**
- Typeahead / autocompletado de comandos slash
- Autocompletado de canales Slack (@canal)
- Autocompletado de archivos via @ mentions
- Highlighting de texto seleccionado
- Sugerencias de prompts (IA-powered)
- Paste de imágenes del portapapeles
- Modo vim completo (insert/normal/visual)
- Historia de comandos con Ctrl+R (fuzzy search)
- Editar en editor externo (vim, etc.) con Ctrl+X Ctrl+E
- Detección de trigger especial: `think harder`, `ultrathink`, `ultraplan`
- Detección de presupuesto de tokens: `$200`, etc.

### 3B. CÓMO SE MUESTRAN LAS HERRAMIENTAS

**Durante ejecución (spinner):**
```
⠴ Bash(npm test)                                        42s · 1.2k tokens
  ↳ Running tests in background...
```

**Output colapsable para ciertos comandos:**
```
▶ Bash(cat README.md) [Read 1 file]          ← Colapsado para comandos read
  [click to expand]
```

**Output expandido:**
```
▼ Bash(cat README.md) [Read 1 file]
  ─────────────────────────────────────────────────────────
  # My Project
  This is the README...
  ─────────────────────────────────────────────────────────
```

**Para ediciones de archivo (FileEditTool):**
```
● Updated /src/components/App.tsx
  ─────────────────────────────────────────────────────────
   1 │  import React from 'react'            
   2 │ -import { useState } from 'react'     ← línea eliminada
   2 │ +import { useState, useEffect } from 'react'  ← línea añadida
   3 │  export function App() {
  ─────────────────────────────────────────────────────────
  +1 line, -1 line
```

**Para herramientas destructivas (request de permiso):**
```
Claude wants to run a bash command:
  rm -rf /tmp/old-build

Allow? [y/n/always/never]
```

**Agrupación de herramientas read-only:**
```
◆ [Searched 3 files, Listed 2 directories]  ← Colapsado como grupo
  ↑ Ctrl+O to expand
```

### 3C. CÓMO SE VEN LOS MENSAJES DEL AGENTE

**Mensaje normal del asistente:**
```
● Claude  ─────────────────────────────────────────────────────────────────
  I'll analyze the code and fix the bug...
  
  ```typescript
  const fix = () => {          ← Syntax highlighting vía ColorFile (Rust/NAPI)
    return value ?? default;
  }
  ```

```

**Thinking blocks (extended thinking):**
```
◆ Thinking...  ─────────────────────────────────────────────────────────── 
  [shimmer animación mientras piensa]
  
  ─── After thinking ────────────────────────────────────────────────────── 
  Based on my analysis...
```

**Mensajes de error:**
```
✕ Error: API timeout after 30s
  Rate limit reached. Retry in 2 minutes.
  
  [retry]  [cancel]
```

**Compact boundary:**
```
┄┄┄┄┄┄┄┄ ⟳ Context compacted: conversation history summarized ┄┄┄┄┄┄┄┄┄┄
```

### 3D. PROGRESS INDICATORS

**SpinnerWithVerb — spinner principal:**
```typescript
// 3 modos de spinner:
type SpinnerMode = 
  | 'idle'      // Sin actividad  
  | 'loading'   // Pensando/cargando
  | 'bash'      // Ejecutando bash

// El mensaje cambia según la actividad:
"Thinking..."
"Running npm test..."
"Reading 3 files..."
"Searching for pattern..."
"Writing to App.tsx..."

// Después de 30s muestra contador de tokens
"Thinking... · 1.4k tokens"

// "Stall detection" — cambia color a rojo después de tiempo sin actividad
// ShimmerChar — efecto de shimmer/glimmer en el texto del spinner
// GlimmerMessage — mensaje animado durante estados de espera
```

**BashModeProgress** — progreso específico de ejecución bash:
- Muestra tiempo transcurrido
- Muestra stdout/stderr en tiempo real (streaming)
- Auto-colapsa después de completar

**TeammateSpinner** — para agentes paralelos:
- Árbol de agentes con niveles de indentación
- Cada agente tiene su propio color
- Muestra estado individual de cada agente

### 3E. STATUS LINE (pie de página customizable)

```typescript
// La status line puede ser completamente customizada via hook
// settings.statusLine = "path/to/script.sh"
// El script recibe JSON con:
{
  model: { id, display_name },
  workspace: { current_dir, project_dir, added_dirs },
  version: "1.2.3",
  output_style: { name },
  cost: { total_cost_usd, total_duration_ms, total_lines_added, total_lines_removed },
  context_window: { total_input_tokens, total_output_tokens, context_window_size, used_percentage },
  rate_limits: { five_hour, seven_day },
  session_name: "Mi sesión",
  exceeds_200k_tokens: false
}
// Y devuelve ANSI-formatted text para mostrar

// Default status line muestra:
// [model] [permission mode] [cwd] [tokens %]
```

---

## 4. SISTEMA DE CONFIGURACIÓN COMPLETO

### 4A. ESQUEMA DE SETTINGS

**Configuración de Herramientas (Hooks system):**
```json
// .claude/settings.json
{
  "hooks": {
    "PostToolUse": [
      {
        "type": "command",
        "command": "ruff format $TOOL_INPUT_PATH",
        "if": "FileEdit(*.py)",
        "statusMessage": "Formatting Python file...",
        "timeout": 10
      }
    ],
    "PreToolUse": [
      {
        "type": "prompt", 
        "prompt": "Rate safety of: $ARGUMENTS",
        "if": "Bash(*)"
      }
    ],
    "Stop": [
      {
        "type": "command",
        "command": "notify-send 'Claude done'",
        "async": true
      }
    ]
  }
}
```

**Configuración de Permisos:**
```json
{
  "permissions": {
    "allow": [
      "Bash(git *)",
      "Bash(npm *)",
      "FileEdit(/src/*)",
      "FileRead(*)"
    ],
    "deny": [
      "Bash(rm -rf *)",
      "Bash(sudo *)"
    ],
    "additionalDirectories": ["/home/user/shared-libs"]
  }
}
```

**Configuración de MCP:**
```json
{
  "mcpServers": {
    "github": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "env": { "GITHUB_TOKEN": "$GITHUB_TOKEN" }
    },
    "filesystem": {
      "type": "stdio", 
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/workspace"]
    }
  }
}
```

### 4B. KEYBINDINGS CUSTOMIZABLES

```json
// ~/.claude/keybindings.json
{
  "context": "Chat",
  "bindings": {
    "ctrl+shift+enter": "chat:submit",   // Override submit key
    "meta+k": "app:clearHistory",        // Custom action
    "f5": "chat:cycleMode"               // Custom cycle
  }
}
```

### 4C. TEMAS

```typescript
// /theme command → ThemePicker UI
// Temas disponibles: dark, light, dark-ansi, light-ansi, etc.
// Colores customizables en settings
// useTheme() hook retorna tema actual
// El tema afecta: syntax highlighting, diffs, UI components
```

---

## 5. LO MÁS INNOVADOR Y DIFERENCIADOR

### 5A. STACK TÉCNICO ÚNICO

**React + Ink para terminal:**
- Toda la UI es React funcional con hooks, estado, efectos
- Componentes React renderizados en terminal en vez de browser
- React Compiler habilitado para optimización de re-renders
- CSS/flexbox en terminal via Yoga layout engine
- `useAnimationFrame(50)` — animaciones a 50fps en terminal
- Virtual scroll para listas largas de mensajes
- Fullscreen mode: interfaz de pantalla completa

**Rust/NAPI para operaciones costosas:**
- Syntax highlighting (ColorFile) — módulo nativo Rust
- Diff rendering (ColorDiff) — módulo nativo Rust
- Radical mejora de performance vs soluciones JS

**Bun runtime (no Node.js):**
- Feature flags con dead code elimination en build time
- `feature('FLAG_NAME')` — código eliminado en builds externos
- Carga diferida de módulos pesados
- Build system con minificación y tree-shaking

### 5B. SISTEMA DE SKILLS

```typescript
// Skills = workflows reutilizables que agrupan prompts + config de herramientas
// 16 skills bundled:
'batch'           // Operaciones batch en múltiples archivos
'claudeApi'       // Interacción directa con API Anthropic
'debug'           // Workflows de debugging
'loop'            // Bucles de refinamiento iterativo
'remember'        // Persistir información en memoria
'scheduleRemoteAgents' // Programar agentes remotos
'simplify'        // Simplificar código complejo
'skillify'        // Crear nuevos skills desde workflows
'stuck'           // Destrabarse cuando bloqueado
'updateConfig'    // Modificar config programáticamente
'verify'          // Verificar corrección de código
```

### 5C. EXTENDED THINKING

```typescript
// Modo "thinking" — el modelo piensa antes de responder
// Budget de tokens configurable
// Visualización: shimmer animado durante el pensamiento
// Thinking blocks mostrados y colapsables
// /effort command — ajustar nivel de esfuerzo
// Triggers especiales: "think harder", "ultrathink" (detectados en input)
// DISABLE_INTERLEAVED_THINKING env var
// ThinkingToggle component en footer
```

### 5D. OUTPUT STYLES

```typescript
// /output-style — cambiar formato del output
// Estilos disponibles:
// 'default' — output normal con markdown
// 'brief'   — respuestas cortas
// 'verbose' — output detallado
// 'auto'    — IA decide según contexto
// El estilo se puede cambiar durante la sesión
// Visible en StatusLine
```

### 5E. SPECULATIVE EXECUTION (PROMPT SUGGESTIONS)

```typescript
// PromptSuggestion service — especula qué probablemente el usuario escribirá
// Speculation: pre-ejecuta la query antes de que el usuario la envíe
// Abortable cuando el usuario cambia de dirección
// Reduce latencia percibida significativamente
// src/services/PromptSuggestion/
```

### 5F. PROACTIVE MODE (KAIROS)

```typescript
// feature('PROACTIVE') o feature('KAIROS')
// El agente puede actuar de forma autónoma sin input del usuario
// SleepTool: el agente "duerme" y espera triggers
// ScheduleCronTool: crea disparadores programados
// RemoteTriggerTool: disparadores remotos
// Background housekeeping: limpieza, consolidación de memorias
```

### 5G. IDE BRIDGE (Integración bidireccional)

```typescript
// Bridge = comunicación CLI ↔ IDE (VS Code, JetBrains)
// JWT auth entre CLI e IDE
// La IDE envía: archivo activo, selección, contexto
// La CLI envía: diffs para mostrar en IDE, comandos
// Diff preview en IDE (useDiffInIDE hook)
// IDE @ mentions: @archivo en el IDE = incluir archivo en contexto
// IdeStatusIndicator: estado de conexión en footer
```

### 5H. GLOBAL SEARCH Y QUICK OPEN

```typescript
// Ctrl+Shift+F → GlobalSearchDialog — buscar en todos los archivos
// Ctrl+Shift+P → QuickOpenDialog — abrir archivo rápidamente (type para filtrar)
// Ambos funcionan como VS Code dentro del terminal
// feature('QUICK_SEARCH') gatea esta funcionalidad
```

### 5I. MULTI-SESSION Y BACKGROUND SESSIONS

```typescript
// Varias sesiones simultáneas
// Sesiones en background (isBgSession)
// /session command para gestión de sesiones
// Auto-gen de títulos de sesión via IA
// Session tags para organización
// /share para compartir sesión via link
// /teleport para transferir sesión a otro dispositivo
// /export para exportar a archivo
```

### 5J. HOOKS SYSTEM (AUTOMATIZACIÓN)

El sistema de hooks es extraordinariamente flexible:
```typescript
// 8 eventos disponibles (PreToolUse, PostToolUse, PreCompact, etc.)
// Tipos de hook: command (bash), prompt (LLM), agent (sub-agente)
// Flags: async, asyncRewake, once, timeout, statusMessage
// asyncRewake: hook async que puede despertar al modelo si hay error
// Filtrado via `if` con permission rule syntax
// Equivalente a CI/CD triggers pero para cada acción del agente
```

### 5K. BUDDY (COMPANION SPRITE)

```typescript
// CompanionSprite.tsx — sprite visual animado (¡sí, en terminal!)
// Aparece cuando Claude "recuerda" algo especial
// companionReservedColumns — reserva columnas para el sprite
// findBuddyTriggerPositions — detecta triggers en el texto
// Solo en builds internos (ant-only)
```

### 5L. X402 PAYMENT PROTOCOL

```typescript
// /x402 command — integración con protocolo de pagos web x402
// Los agentes pueden hacer micro-pagos para acceder a recursos de pago
// src/services/x402/
// Completamente nuevo paradigma: agentes que pagan por acceso a APIs
```

---

## 6. PLAN DE IMPLEMENTACIÓN PARA ORBIT CODE

### FASE 1 — Core CLI (Semanas 1-3)

**Objetivo:** CLI funcional con herramientas básicas

1. **Entrypoint CLI** (`src/cli.ts`)
   - Commander.js para parsing
   - Flags: `--model`, `--print`, `--continue`, `--resume`
   - Fast paths: `--version`, `--help`
   - Variables de entorno equivalentes a Claude Code

2. **Motor de Query** (`src/engine/query-engine.ts`)
   - Loop de tool-calls: LLM → herramienta → resultado → LLM
   - Streaming de tokens en tiempo real
   - Retry automático con exponential backoff
   - Token counting por turno
   - Soporte multi-provider: Anthropic, OpenAI, Ollama, Gemini (ya existe en Orbit)

3. **Sistema de Herramientas base** (`src/tools/`)
   - `buildTool()` factory con schema Zod
   - Herramientas prioritarias:
     - `BashTool` / `PowerShellTool`
     - `FileReadTool`, `FileWriteTool`, `FileEditTool` (con string replacement)
     - `GlobTool`, `GrepTool`
     - `WebSearchTool`, `WebFetchTool`
   - Cada herramienta: `call()`, `checkPermissions()`, `renderToolUseMessage()`, `renderToolResultMessage()`

4. **REPL básico** usando Ink
   ```typescript
   // React + Ink para terminal
   // PromptInput básico
   // Spinner animado
   // Historial de conversación
   ```

### FASE 2 — UX Pulida (Semanas 4-6)

5. **Sistema de Permisos** (`src/permissions/`)
   - 4 modos: default, plan, bypassPermissions, auto
   - Reglas wildcard `Tool(pattern)` 
   - UI de solicitud de permisos
   - `allow/deny/always/never` en prompts

6. **Syntax Highlighting**
   - Integrar `cli-highlight` o `highlight.js` (o compilar módulo Rust via NAPI)
   - Cache de renders a nivel de módulo
   - Detección de lenguaje por extensión + shebang

7. **Diff Rendering**
   - `StructuredDiff` usando `diff` npm package + syntax highlighting
   - Gutter con números de línea
   - Colores: verde para adiciones, rojo para eliminaciones
   - Cache de renders para performance

8. **Status Line**
   - Modelo activo
   - Modo de permiso
   - Tokens usados / tamaño del context window
   - Porcentaje restante
   - Customizable via script externo (hook)

9. **Context Window Tracking**
   - Contador de tokens por turno
   - Warnings a 80%, 90%, 95%
   - Token warning visual en UI
   - Auto-compact al superar threshold

### FASE 3 — Comandos Slash (Semanas 7-9)

10. **Sistema de Comandos** (`src/commands/`)
    - 3 tipos: PromptCommand, LocalCommand, LocalJSXCommand
    - Autocompletado en input
    - Comandos prioritarios:
      ```
      /help, /clear, /exit, /version
      /model, /cost, /status
      /commit, /diff, /review
      /compact
      /doctor
      /config, /permissions
      /memory, /init
      /mcp
      ```

11. **Comandos Git:**
    - `/commit` — AI-generated commit messages
    - `/diff` — Visualizar cambios
    - `/review` — Code review

12. **Comandos de Sesión:**
    - `/resume` — Restaurar sesión
    - `/session` — Gestionar sesiones
    - `/export` — Exportar conversación
    - `/clear` — Limpiar historial

### FASE 4 — Memoria y Contexto (Semanas 10-11)

13. **Sistema ORBIT.md** (equivalente a CLAUDE.md)
    ```
    ~/.orbit/ORBIT.md           ← Memoria personal global
    {proyecto}/ORBIT.md         ← Memoria del proyecto
    {proyecto}/ORBIT.local.md   ← Overrides privados
    ```
    - Import via `@{ruta/archivo}`
    - Auto-lectura al inicio de sesión
    - `/init` para crear ORBIT.md inicial
    - `/memory` para gestionar memorias

14. **Auto-memoria (memdir equivalente)**
    - Extracción automática de memorias al final de cada turno
    - 4 tipos: user, feedback, project, reference
    - Búsqueda de memorias relevantes por contexto

15. **Compactación de Contexto**
    - Auto-compact al ~85% del context window
    - Sub-agente compactador independiente
    - Compact boundary en el transcripto
    - `/compact` command manual

### FASE 5 — Sub-agentes y Tareas (Semanas 12-13)

16. **AgentTool** — Sub-agentes
    - Colores únicos por agente
    - Stack de agentes anidados
    - InProcessTeammateTask (rápido, mismo proceso)
    - LocalAgentTask (proceso separado)

17. **Sistema de Tareas**
    - TaskCreateTool, TaskUpdateTool, etc.
    - Panel visual de tareas (Ctrl+T)
    - TodoWriteTool

### FASE 6 — MCP y Plugins (Semanas 14-15)

18. **MCP Client**
    - `@modelcontextprotocol/sdk` (ya existe como dependencia)
    - Configuración de servidores MCP en settings
    - MCPTool para invocar herramientas MCP
    - ListMcpResourcesTool, ReadMcpResourceTool
    - `/mcp` command para gestión

19. **Orbit como servidor MCP**
    - Exponer herramientas propias de Orbit via MCP
    - Permitir que otros agentes usen Orbit

20. **Sistema de Skills**
    - SkillTool
    - Skills base: debug, verify, remember, loop, stuck
    - `/skills` command
    - Crear skills desde workflows (skillify)

### FASE 7 — Configuración Avanzada (Semana 16)

21. **Hooks System**
    - 8 eventos: PreToolUse, PostToolUse, SessionStart, Stop, etc.
    - Tipos: command, prompt, agent
    - `/hooks` command con UI
    - Filtrado via permission rule syntax

22. **Keybindings Customizables**
    - `~/.orbit/keybindings.json`
    - Sistema de contextos (Global, Chat, Autocomplete, etc.)
    - `/keybindings` command

23. **Settings UI Completo**
    - `/config` → Abre TUI de settings completo
    - Pestañas: Config, Permissions, MCP, Hooks, etc.

### FASE 8 — Features Premium (Semanas 17+)

24. **Modo Voice** (`/voice`)
    - Push-to-talk (Space)
    - STT para input
    - TTS para output

25. **Extended Thinking Mode**
    - Thinking blocks con shimmer
    - Budget de tokens configurable
    - `/effort` command
    - Triggers: "think harder", "ultrathink"

26. **Global Search / Quick Open**
    - Ctrl+Shift+F → buscar en archivos
    - Ctrl+Shift+P → open file rapidly

27. **Proactive Mode**
    - SleepTool, ScheduleCronTool
    - Acciones autónomas sin input del usuario
    - `/tasks` con scheduling

---

## 7. DIFERENCIADORES COMPETITIVOS PARA ORBIT CODE

### Orbit Code DEBE tener (paridad con Claude Code):
1. ✅ Multi-provider (Anthropic, OpenAI, Ollama, Gemini) — Orbit ya lo tiene
2. ✅ Sistema de permisos granular con wildcards
3. ✅ Syntax highlighting + diff rendering
4. ✅ Sistema de memoria via ORBIT.md
5. ✅ Comandos slash extensos
6. ✅ Extended thinking
7. ✅ MCP client + server
8. ✅ Sub-agentes y parallelismo
9. ✅ Hooks system
10. ✅ Auto-compactación de contexto

### Orbit Code PUEDE SUPERAR a Claude Code en:
1. **Multi-provider nativo** — Claude Code solo usa Anthropic; Orbit soporta cualquier LLM
2. **Electron overlay** — Orbit tiene overlay visual en el desktop (Claude Code no)
3. **Costo** — Orbit puede usar modelos baratos (Ollama local, etc.)
4. **Sin lock-in** — Orbit es completamente open source
5. **Windows-first** — Claude Code tiene bugs en Windows; Orbit puede priorizarlo
6. **Plugin marketplace local** — Sin necesidad de aprobación de Anthropic
7. **Integración con Spotify, Notion, etc.** — Los skills de Orbit ya lo tienen
8. **Chat history SQLite** — Persistencia robusta ya implementada en Orbit

### Features exclusivas que Orbit debería tener:
1. **Modo portátil** — `orbit.exe` sin instalación, config en carpeta relativa
2. **Modo offline** — Solo con Ollama, sin internet
3. **Multi-workspace** — Varios proyectos en tabs simultáneos
4. **Historial visual** — Timeline de sesiones más visual que `/session`
5. **Precio justo** — Sin pricing de API de propietario

---

## 8. ARCHITECTURE RECOMENDADA PARA ORBIT CODE

```typescript
// Stack sugerido (alineado con Claude Code pero open-source):
Runtime:    Bun (igual que Claude Code — mejor DX y performance)
UI:         React + Ink (igual que Claude Code — probado en producción)
Schema:     Zod v4 (igual)
Styling:    Chalk (igual)
CLI:        Commander.js (igual)
Syntax HL:  cli-highlight (temporal) → módulo Rust NAPI (futuro)
Diff:       diff npm package → módulo Rust NAPI (futuro)
DB:         better-sqlite3 (igual — Orbit ya lo usa)
MCP:        @modelcontextprotocol/sdk (igual)
HTTP:       axios (igal — ya en Orbit)

// Estructura de directorios sugerida:
src/
├── entrypoints/
│   ├── cli.tsx              ← Punto de entrada
│   └── mcp.ts               ← Orbit como servidor MCP
├── engine/
│   └── query-engine.ts      ← Motor LLM central
├── tools/                   ← Herramientas individuales
│   ├── BashTool/
│   ├── FileEditTool/
│   ├── FileReadTool/
│   └── ...
├── commands/                ← Comandos slash
│   ├── commit/
│   ├── config/
│   └── ...
├── components/              ← Componentes React/Ink
│   ├── PromptInput/
│   ├── Messages/
│   ├── Spinner/
│   ├── StructuredDiff.tsx
│   └── ...
├── hooks/                   ← React hooks
│   ├── useCanUseTool.ts
│   ├── toolPermission/
│   └── ...
├── services/
│   ├── mcp/
│   ├── analytics/
│   └── ...
├── memory/
│   └── memdir.ts
├── state/
│   └── AppStateStore.ts
└── schemas/
    ├── settings.ts
    └── hooks.ts
```

---

## 9. ARCHIVOS CLAVE PARA IMPLEMENTAR PRIMERO

Orden recomendado de implementación basado en dependencias:

```
1. src/Tool.ts              ← Base de todas las herramientas
2. src/tools.ts             ← Registro de herramientas
3. src/engine/query-engine.ts ← Motor central
4. src/tools/BashTool/
5. src/tools/FileEditTool/
6. src/tools/FileReadTool/
7. src/tools/GlobTool/
8. src/tools/GrepTool/
9. src/commands.ts          ← Registro de comandos
10. src/screens/REPL.tsx    ← UI principal
11. src/components/PromptInput/
12. src/components/Messages/
13. src/components/Spinner/
14. src/components/StructuredDiff.tsx
15. src/memdir/             ← Sistema de memoria
16. src/hooks/toolPermission/ ← Sistema de permisos
17. src/services/mcp/       ← MCP client
18. src/keybindings/        ← Keybindings
19. src/schemas/            ← Schemas de configuración
```

---

*Generado el 31 de marzo de 2026 — Análisis completo del codebase Claude Code filtrado*
*Fuente: C:\Users\HP\Desktop\inspo\claude-code-main*

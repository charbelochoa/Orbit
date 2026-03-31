# ORBIT CODE — Plan de Implementación Competitivo

> Basado en análisis exhaustivo de Claude Code (`@anthropic-ai/claude-code` 2026-03-31).
> Orbit ya tiene una base sólida. Este plan cubre todo lo que falta para rivalizar y superar a Claude Code.

---

## Estado actual de Orbit ✅

| Componente | Estado |
|---|---|
| Multi-provider LLM (Gemini/OpenAI/Anthropic/Ollama) | ✅ |
| Tool registry + policy engine (allow/deny/ask) | ✅ |
| CLI interactivo (`src/cli-chat.ts`) | ✅ |
| Slash commands básicos (/task /stop /clear /memory /model /status /help /exit) | ✅ |
| WebSocket gateway (puerto 18789) | ✅ |
| Web UI dark theme | ✅ |
| Braille spinner, markdown renderer, tool blocks | ✅ |
| Context bar `[████░░ 42%]` | ✅ |
| Token tracking (input/output/total) | ✅ |
| `/init` → genera ORBIT.md | ✅ |
| Electron overlay | ✅ |

---

## FASE 1 — Core UX (impacto máximo, 1-2 semanas)

### 1.1 Permission dialogs interactivos
**Qué hace Claude Code:** Cuando el agente quiere ejecutar un tool peligroso (bash command, editar archivo fuera del proyecto), pausa y muestra un diálogo inline:
```
 ● Bash: rm -rf dist/
  ╔══════════════════════════════════════╗
  ║  ¿Permitir esta acción?              ║
  ║  [y] Sí   [n] No   [a] Siempre      ║
  ╚══════════════════════════════════════╝
```
- `y` / Enter → permite una vez
- `a` → persiste en `.orbit/settings.local.json`
- `n` / Escape → deniega y notifica al modelo

**Archivo a crear:** `src/cli-chat.ts` — método `askPermission(tool, description): Promise<'allow'|'deny'|'always'>`  
**Archivo a modificar:** `src/core/tool-policy.ts` — cuando behavior='ask', retorna un callback async en vez de bloquear  
**Archivo a modificar:** `src/gateway/server.ts` — emite evento `permission_request` por WebSocket, CLI responde con `permission_response`

---

### 1.2 Diff rendering con colores (+ verde / - rojo)
**Qué hace Claude Code:** Al editar archivos, muestra un diff unificado con:
- Líneas `+` en verde (`fgRGB(34, 197, 94)`)
- Líneas `-` en rojo (`fgRGB(239, 68, 68)`)
- Líneas de contexto en gris dim
- Header del hunk en purple dim (`@@ -N,M +N,M @@`)

**Librería:** `diff` (ya popular, `npm i diff`) → `structuredPatch()`  
**Archivo a crear:** `src/cli-chat.ts` — método `renderDiff(patch: string): string`  
**Archivo a modificar:** `src/actions/file-controller.ts` — emite `{ type: 'file_diff', patch }` en el output del tool

---

### 1.3 Tab-completion para slash commands
**Qué hace Claude Code:** Al escribir `/` muestra un menú de autocomplete que se filtra mientras tecleas.

```
> /co█
  ╔══════════════╗
  ║ /compact     ║  ← seleccionado
  ║ /cost        ║
  ║ /config      ║
  ╚══════════════╝
```

**Implementación en `src/cli-chat.ts`:**
- Hook en `rl.on('line')` + raw mode para capturar Tab
- Al pulsar Tab con `/` al inicio: filtra `SLASH_COMMANDS` y muestra menu con ANSI
- Navegar con Tab/Shift+Tab, Enter confirma, Escape cierra

---

### 1.4 Historial con Ctrl+R
**Qué hace Claude Code:** `Ctrl+R` abre un mini buscador de mensajes anteriores (como bash reverse-search).

**Implementación:**  
- En `OrbitCLI` guardar `messageHistory: string[]`
- `Ctrl+R` activa modo historySearch: muestra `(reverse-i-search): ` y filtra mientras tecleas
- Enter rellena el input, Escape cancela

---

## FASE 2 — Comandos slash adicionales (1 semana)

### 2.1 `/cost` — Mostrar costo de la sesión
```
  Tokens de entrada:   12,450  ($0.0373)
  Tokens de salida:     3,200  ($0.0384)
  Total sesión:        15,650  ($0.0757)
  Modelo:              gemini-2.5-pro
```
**Archivo:** `src/auto-reply/commands/cost.ts`  
Usar los `tokensUsed` que ya trackea el gateway.

---

### 2.2 `/compact` — Resumir y limpiar contexto
**Qué hace Claude Code:** Envía al modelo el prompt "Resume esta conversación en bullet points clave para continuar el trabajo" → limpia el historial → inyecta el resumen como contexto del sistema.

**Archivo:** `src/auto-reply/commands/compact.ts`  
Parámetro opcional: `/compact <instrucciones adicionales>`

---

### 2.3 `/diff` — Ver git diff del proyecto
```
> /diff
  Modified: src/actions/file-controller.ts (+12, -3)
  Modified: src/cli-chat.ts (+47, -8)
```
**Archivo:** `src/auto-reply/commands/diff.ts`  
Ejecuta `git diff --stat` y `git diff` con colores del renderer de diffs.

---

### 2.4 `/doctor` — Diagnóstico del sistema
```
> /doctor
  ✓ Node.js v22.11.0
  ✓ Gateway conectado (puerto 18789)
  ✓ Modelo activo: gemini-2.5-pro
  ✓ API key configurada: GEMINI_API_KEY
  ✗ OPENAI_API_KEY no configurada
  ✓ Memoria: 847 tokens almacenados
  ✓ ORBIT.md encontrado en este proyecto
```
**Archivo:** `src/auto-reply/commands/doctor.ts`

---

### 2.5 `/review` — Code review del diff actual
Inyecta prompt: "Revisa los cambios en el git diff y da feedback detallado de calidad, bugs potenciales y mejoras."  
**Archivo:** `src/auto-reply/commands/review.ts`  
Tipo: `prompt` (inyecta directo al modelo con el git diff como contexto)

---

### 2.6 `/rewind` — Volver al turno anterior
Elimina los últimos N mensajes del historial, permitiendo "deshacer" la última respuesta del agente.  
**Archivo:** `src/auto-reply/commands/rewind.ts`  
Parámetro: `/rewind` (último turno) o `/rewind 3` (últimos 3 turnos)

---

### 2.7 `/todos` — Gestión de tareas integrada
Muestra/ actualiza una lista de TODOs persistida en `.orbit/todos.json`:
```
> /todos
  ● [en progreso] Implementar permission dialogs
  ○ [pendiente]   Diff rendering
  ✓ [completado]  /init command
```
**Archivos:**  
- `src/auto-reply/commands/todos.ts`  
- El agente puede emitir `{ type: 'todo_update', todos: [...] }` y el CLI los muestra inline

---

## FASE 3 — Herramientas del agente (2 semanas)

### 3.1 Bash/PowerShell tool mejorada
La acción `cmd-control.ts` ya existe. Mejorar:
- Timeout configurable (default 30s, max 120s)
- `run_in_background: true` → lanza proceso y continúa (notifica cuando termina)
- Output streaming al CLI en tiempo real (no esperar al final)
- Detección automática de comandos de lectura (git status, ls, cat) → colapsables en UI

**Archivos:** `src/actions/cmd-control.ts`, `src/cli-chat.ts` (streaming output block)

---

### 3.2 File Edit tool (edición quirúrgica)
**Qué hace Claude Code:** `old_string → new_string` en vez de reescribir el archivo entero.  
Ventajas: más seguro, diff más limpio, menos tokens.

**Archivo a crear:** `src/actions/file-edit.ts`
```typescript
// Parámetros:
{ file_path: string, old_string: string, new_string: string, replace_all?: boolean }
// - Verifica que old_string aparece EXACTAMENTE UNA VEZ (o replace_all=true)
// - Aplica el cambio y emite diff
```

---

### 3.3 Glob tool
**Archivo a crear:** `src/actions/glob-tool.ts`  
Usa `fast-glob` para buscar archivos con patrones.
```typescript
{ pattern: string, path?: string }
// → filenames[], numFiles, truncated (máx 200)
```

---

### 3.4 Grep tool mejorada
La acción `web-search.ts` existe para búsqueda web. Crear una búsqueda de contenido local:  
**Archivo a crear:** `src/actions/grep-tool.ts`  
Usa `ripgrep` (rg) si disponible, fallback a implementación JS con `fast-glob` + `fs.readFile`.
```typescript
{ pattern: string, path?: string, glob?: string, '-i'?: boolean, '-n'?: boolean, head_limit?: number }
```

---

### 3.5 WebFetch tool
**Qué hace Claude Code:** Descarga una URL, convierte HTML → Markdown, aplica un prompt sobre el contenido.  
**Archivo a modificar:** `src/actions/web-search.ts` → añadir `fetchUrl(url, prompt)` separado de la búsqueda.

---

### 3.6 Todo tracking del agente
El agente puede crear/actualizar/completar tareas vía herramientas `todo_write` / `todo_read`.  
Sincronizado con el CLI (`/todos`) y mostrado en el Web UI.

---

## FASE 4 — Sistema de Permisos avanzado (1 semana)

### 4.1 Capas de configuración
```
Prioridad (mayor a menor):
1. policy (hardcoded — archivos del sistema nunca editables)
2. userSettings     → ~/.orbit/settings.json
3. projectSettings  → .orbit/settings.json   (commitable)
4. localSettings    → .orbit/settings.local.json (en .gitignore)
5. session          → en-memory (persiste hasta cerrar)
```

### 4.2 Archivos protegidos automáticamente
```typescript
const PROTECTED_FILES = ['.gitconfig', '.bashrc', '.zshrc', '.env', '.orbit/settings.json']
const PROTECTED_DIRS  = ['.git', '.orbit', 'node_modules']
```

### 4.3 Wildcards en reglas
```yaml
# .orbit/settings.json
allow:
  - "Bash(git *)"
  - "Bash(npm run *)"
  - "file_write(src/**)"
deny:
  - "Bash(rm -rf *)"
  - "file_write(*.env)"
```

---

## FASE 5 — MCP (Model Context Protocol) (2 semanas)

**Qué es:** Protocolo estándar para conectar herramientas externas al agente. Claude Code tiene 50+ servidores MCP de la comunidad.

### 5.1 Cliente MCP básico
- **Transporte stdio:** lanza proceso hijo, comunica vía stdin/stdout JSON-RPC
- **Transporte HTTP/SSE:** conecta a servidor remoto
- **Archivo:** `src/mcp/client.ts`

### 5.2 Registro de servidores MCP
```yaml
# ~/.orbit/mcp.json
{
  "servers": {
    "filesystem": { "command": "npx", "args": ["@modelcontextprotocol/server-filesystem", "/home/user"] },
    "github": { "command": "npx", "args": ["@modelcontextprotocol/server-github"], "env": { "GITHUB_TOKEN": "${GITHUB_TOKEN}" } },
    "postgres": { "url": "http://localhost:5173/sse" }
  }
}
```

### 5.3 Slash command `/mcp`
```
/mcp list          → lista servidores configurados
/mcp enable github → activa servidor
/mcp disable github→ desactiva
/mcp logs github   → ver logs del servidor
```

---

## FASE 6 — Hooks del ciclo de vida (1 semana)

**Qué hace Claude Code:** 8 eventos donde puedes inyectar comportamiento custom.

### Eventos disponibles
| Hook | Cuándo se dispara |
|---|---|
| `PreToolUse` | Antes de ejecutar cualquier tool |
| `PostToolUse` | Después de que un tool termina |
| `SessionStart` | Al iniciar Orbit |
| `SessionEnd` | Al cerrar Orbit |
| `UserMessage` | Cuando el usuario envía un mensaje |
| `AssistantMessage` | Cuando el modelo responde |
| `OrbitStop` | Cuando el modelo decide parar |
| `Notification` | Para notificaciones del sistema |

### Configuración
```yaml
# .orbit/settings.json
hooks:
  PreToolUse:
    - match: "Bash"
      command: "echo 'Ejecutando: ${tool_input.command}'"
  PostToolUse:
    - match: "file_write"
      command: "npx prettier --write ${tool_input.file_path}"
  SessionEnd:
    - command: "git add -A && git commit -m 'Orbit: cambios de sesión'"
```

**Archivo:** `src/hooks/runner.ts` — ejecuta el hook command con env vars del tool

---

## FASE 7 — Sub-agentes y Tareas Async (2 semanas)

**Qué hace Claude Code:** El agente principal puede lanzar subagentes paralelos para tareas que no se bloquean entre sí.

### 7.1 Task API
```typescript
// Tools del agente:
task_create({ description, prompt, model? }) → { task_id }
task_get({ task_id })    → { status, output, error }
task_list()              → Task[]
task_stop({ task_id })
task_output({ task_id }) → streaming output
```

### 7.2 CLI: panel de tareas
`Ctrl+T` abre un panel lateral en el CLI mostrando tareas en curso:
```
 ┌─ Tareas activas ────────────────┐
 │ ⠸ task-001  Analizar src/...    │
 │ ✓ task-002  Escribir tests      │
 │ ✗ task-003  Error en build      │
 └─────────────────────────────────┘
```

---

## FASE 8 — Diferenciadores únicos de Orbit (3 semanas)

### 8.1 Electron Overlay global (ya existe la base)
Claude Code no tiene esto. Orbit puede activarse con un hotkey global (Alt+Space) y flotar sobre cualquier app.
- Detectar contexto: ¿qué app está en foco? ¿hay texto seleccionado?
- Acciones contextuales: "Explica esto", "Refactoriza esto", "Busca bugs"

### 8.2 Multi-provider con fallback automático
Claude Code = solo Anthropic. Orbit tiene 4 providers y puede:
- Usar Gemini para tareas largas (contexto mayor)
- Usar OpenAI para tool-use confiable
- Usar Ollama para tareas offline/privadas
- Fallback automático si un provider falla o rate-limita

### 8.3 Windows-first
Claude Code tiene bugs en Windows (paths, PowerShell, permisos). Orbit es nativo Windows:
- PowerShell como shell default
- Paths con backslash manejados correctamente
- UAC-aware para operaciones de sistema
- Integración con Windows Terminal

### 8.4 `/insights` — Análisis de tus sesiones
```
> /insights
  📊 Análisis de tus últimas 30 sesiones:
  
  Tareas más frecuentes:
  - Refactoring TypeScript (34%)
  - Debug de errores (28%)
  - Escritura de docs (18%)
  
  Herramientas más usadas:
  - file_edit: 1,240 veces
  - bash: 890 veces
  
  Archivos más modificados:
  - src/cli-chat.ts (47 ediciones)
```

---

## Orden de implementación recomendado

```
Semana 1:  Fase 1.1 (permission dialogs) + 1.2 (diff rendering)
Semana 2:  Fase 1.3 (tab-completion) + 1.4 (Ctrl+R history)
Semana 3:  Fase 2 completa (todos los slash commands)
Semana 4:  Fase 3.1-3.3 (bash mejorado, file-edit, glob)
Semana 5:  Fase 3.4-3.6 (grep, webfetch, todos del agente)
Semana 6:  Fase 4 (sistema de permisos avanzado)
Semana 7-8: Fase 5 (MCP)
Semana 9:  Fase 6 (hooks)
Semana 10-11: Fase 7 (sub-agentes)
Semana 12-14: Fase 8 (diferenciadores)
```

---

## Resumen de archivos que crear/modificar

| Archivo | Acción | Fase |
|---|---|---|
| `src/cli-chat.ts` | `askPermission()`, `renderDiff()`, tab-complete, Ctrl+R | 1 |
| `src/gateway/server.ts` | evento `permission_request/response` | 1 |
| `src/core/tool-policy.ts` | callback async para behavior='ask' | 1 |
| `src/actions/file-edit.ts` | NUEVO — edición quirúrgica old→new | 3 |
| `src/actions/glob-tool.ts` | NUEVO — búsqueda por patrón | 3 |
| `src/actions/grep-tool.ts` | NUEVO — búsqueda de contenido local | 3 |
| `src/auto-reply/commands/cost.ts` | NUEVO | 2 |
| `src/auto-reply/commands/compact.ts` | NUEVO — resumir con IA | 2 |
| `src/auto-reply/commands/diff.ts` | NUEVO | 2 |
| `src/auto-reply/commands/doctor.ts` | NUEVO | 2 |
| `src/auto-reply/commands/review.ts` | NUEVO | 2 |
| `src/auto-reply/commands/rewind.ts` | NUEVO | 2 |
| `src/auto-reply/commands/todos.ts` | NUEVO | 2 |
| `src/mcp/client.ts` | NUEVO — cliente MCP stdio+http | 5 |
| `src/hooks/runner.ts` | NUEVO — ejecutor de hooks | 6 |
| `src/agent/task-manager.ts` | NUEVO — sub-agentes async | 7 |

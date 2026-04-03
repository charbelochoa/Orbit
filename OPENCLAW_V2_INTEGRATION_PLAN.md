# OpenClaw v2 → Orbit: Plan de Integración

> Análisis de la nueva versión de OpenClaw (`openclaw-main`) y features a implementar en Orbit.
> Fecha: 2 de abril de 2026

---

## Resumen Ejecutivo

OpenClaw ha evolucionado significativamente. Las áreas con mayor impacto para Orbit son:

| Prioridad | Feature | Impacto | Esfuerzo |
|-----------|---------|---------|----------|
| 🔴 P0 | **Context Engine (Cerebro)** | Crítico — gestión inteligente de contexto | Alto |
| 🔴 P0 | **Skills v2 — Sistema `requires`** | Alto — eligibilidad automática | Medio |
| 🔴 P0 | **Memory con Embeddings** | Alto — búsqueda semántica de memoria | Alto |
| 🟡 P1 | **Subsystem Logger** | Medio — debugging exponencial | Bajo |
| 🟡 P1 | **Session Key System** | Medio — multi-canal/agente | Medio |
| 🟡 P1 | **Plugin Slots Model** | Medio — extensibilidad limpia | Medio |
| 🟢 P2 | **Error Redaction** | Seguridad — tokens no se fugan | Bajo |
| 🟢 P2 | **Config Refresh Handlers** | QoL — hot reload config | Bajo |
| 🟢 P2 | **Hook System mejorado** | Extensibilidad — eventos del ciclo | Medio |

---

## FASE 1: Cerebro / Context Engine

### Qué hace OpenClaw
OpenClaw tiene un **Context Engine** pluggable con esta interfaz:

```typescript
interface ContextEngine {
  ingest(messages): void           // Almacenar mensajes
  assemble(tokenBudget): Message[] // Construir contexto bajo presupuesto de tokens
  compact(): void                  // Comprimir via resúmenes
  afterTurn(): void                // Post-turno: persistir, auto-compactar
  bootstrap(session): void         // Inicializar sesión
  maintain(): void                 // Reescribir transcripts
  prepareSubagentSpawn(): Context  // Heredar contexto a sub-agente
  onSubagentEnded(result): void    // Recibir resultado de sub-agente
}
```

El ciclo es: `bootstrap → ingest* → assemble → afterTurn → compact (si necesario) → maintain`

### Qué tiene Orbit hoy
- `chat-history.ts`: SQLite plano (role + content + timestamp), sin presupuesto de tokens
- `memory-manager.ts`: JSON plano para hechos del usuario, sin embeddings
- Sin compactación ni resumen automático de historial
- Sin gestión de presupuesto de tokens

### Qué implementar

#### 1.1 — `src/context/context-engine.ts` (NUEVO)
```typescript
export interface ContextEngine {
  /** Ingerir mensajes del turno actual */
  ingest(messages: ChatMessage[]): void;

  /** Ensamblar contexto bajo presupuesto de tokens */
  assemble(opts: AssembleOptions): Promise<ChatMessage[]>;

  /** Compactar historial (resumir mensajes viejos) */
  compact(opts?: CompactOptions): Promise<CompactResult>;

  /** Trabajo post-turno (persistir, trigger auto-compact) */
  afterTurn(turnResult: TurnResult): Promise<void>;

  /** Inicializar para una sesión */
  bootstrap(sessionId: string): Promise<void>;

  /** Stats del engine */
  stats(): ContextStats;
}

export interface AssembleOptions {
  tokenBudget: number;       // Max tokens para el contexto
  reserveForResponse: number; // Tokens reservados para respuesta
  includeSystemPrompt: boolean;
  includeMemory: boolean;
  includeSkills: boolean;
}

export interface ContextStats {
  totalTokens: number;
  messageCount: number;
  compactionCount: number;
  lastCompactedAt?: Date;
}

export interface CompactResult {
  tokensBefore: number;
  tokensAfter: number;
  summarized: number; // mensajes resumidos
}
```

#### 1.2 — `src/context/default-engine.ts` (NUEVO)
Implementación por defecto:
- **Token counting**: tiktoken o estimación rápida (4 chars ≈ 1 token)
- **Assembly strategy**: System prompt → Memory facts → Skills → Recent N messages (bajo budget)
- **Compaction**: Resumir mensajes antiguos con LLM cuando se excede 70% del budget
- **Sliding window**: Mantener últimos 20 mensajes completos, comprimir anteriores

#### 1.3 — `src/context/compactor.ts` (NUEVO)
```typescript
export async function compactMessages(
  messages: ChatMessage[],
  provider: LLMProvider
): Promise<{ summary: string; tokensSaved: number }> {
  // Prompt: "Resumir esta conversación preservando hechos clave, decisiones y contexto"
  // El resumen reemplaza los mensajes originales como un solo mensaje [system]
}
```

#### 1.4 — Migración de `chat-history.ts`
- Agregar columna `token_count` a tabla `messages`
- Agregar tabla `compactions(id, session_id, summary, original_count, created_at)`
- El `ContextEngine` usa `ChatHistory` como backend de persistencia

---

## FASE 2: Skills v2 — Sistema de Requisitos

### Qué hace OpenClaw
Las skills tienen `metadata.openclaw.requires`:
```yaml
metadata:
  openclaw:
    emoji: "🐙"
    requires:
      bins: ["gh"]           # Binarios requeridos en PATH
      anyBins: ["claude", "codex"]  # Al menos uno de estos
      env: ["NOTION_API_KEY"]       # Variables de entorno requeridas
    install:                  # Instrucciones de instalación
      - label: "macOS"
        command: "brew install gh"
      - label: "Windows"
        command: "winget install GitHub.cli"
    primaryEnv: "NOTION_API_KEY"
```

El loader verifica `requires` y solo carga skills elegibles.

### Qué tiene Orbit hoy
- Skills con frontmatter básico: `name`, `description`, `category`, `tools[]`, `triggers[]`
- Sin verificación de prerrequisitos
- Todas las skills se cargan siempre

### Qué implementar

#### 2.1 — Extender `src/skills/types.ts`
```typescript
export interface SkillRequirements {
  bins?: string[];       // Binarios requeridos (todos deben existir)
  anyBins?: string[];    // Al menos uno debe existir
  env?: string[];        // Variables de entorno requeridas
  platform?: ('win32' | 'darwin' | 'linux')[];  // SO compatible
}

export interface SkillInstallGuide {
  label: string;    // "Windows", "macOS", "Linux"
  command: string;  // Comando de instalación
}

export interface SkillMetadata {
  name: string;
  description: string;
  emoji?: string;
  category?: string;
  tools?: string[];
  triggers?: string[];
  requires?: SkillRequirements;
  install?: SkillInstallGuide[];
  primaryEnv?: string;
}
```

#### 2.2 — `src/skills/eligibility.ts` (NUEVO)
```typescript
import { execSync } from 'child_process';

export async function checkSkillEligibility(req: SkillRequirements): Promise<{
  eligible: boolean;
  missing: string[];
}> {
  const missing: string[] = [];

  // Verificar binarios
  if (req.bins) {
    for (const bin of req.bins) {
      if (!binaryExists(bin)) missing.push(`bin:${bin}`);
    }
  }

  // Verificar al menos un binario
  if (req.anyBins) {
    const hasOne = req.anyBins.some(b => binaryExists(b));
    if (!hasOne) missing.push(`anyBins:[${req.anyBins.join('|')}]`);
  }

  // Verificar env vars
  if (req.env) {
    for (const v of req.env) {
      if (!process.env[v]) missing.push(`env:${v}`);
    }
  }

  // Verificar plataforma
  if (req.platform && !req.platform.includes(process.platform as any)) {
    missing.push(`platform:${process.platform}`);
  }

  return { eligible: missing.length === 0, missing };
}

function binaryExists(name: string): boolean {
  try {
    execSync(`where ${name}`, { stdio: 'ignore' }); // Windows
    return true;
  } catch {
    return false;
  }
}
```

#### 2.3 — Actualizar `src/skills/loader.ts`
- Parsear `requires` del frontmatter YAML
- Llamar `checkSkillEligibility()` para cada skill
- Log skills no-elegibles con razón (pero no bloquear carga)
- Marcar `skill.eligible: boolean` + `skill.missingRequirements: string[]`
- Solo inyectar skills elegibles en el planner

#### 2.4 — Actualizar frontmatter de skills existentes
```yaml
# skills/github/SKILL.md
---
name: github
description: "GitHub operations via gh CLI"
emoji: "🐙"
category: development
tools: [cmd_control, browser_control]
requires:
  bins: ["gh"]
install:
  - label: "Windows"
    command: "winget install GitHub.cli"
---
```

Repetir para: browser-automation (requiere chrome), coding (requiere node/python), notion (requiere NOTION_API_KEY), spotify (requiere spotify).

---

## FASE 3: Memory con Embeddings

### Qué hace OpenClaw
- SQLite con **vector search** (`sqlite-vec`) + **FTS5** como fallback
- **Chunking** inteligente de documentos (CJK-aware, overlap configurable)
- **Query expansion**: extrae keywords multilingüe para FTS
- **Embedding providers**: OpenAI, Gemini, Ollama, Voyage, Mistral
- **Memory files**: `MEMORY.md` + `memory/` dir
- **Session indexing**: Convierte JSONL de sesiones en texto búscable
- Resultados con: path, lineRange, score, snippet, citation

### Qué tiene Orbit hoy
- `long_term.json`: Objeto plano con identity/preferences/notes
- Sin embeddings, sin búsqueda semántica
- Extracción de hechos cada 5 turnos via LLM

### Qué implementar

#### 3.1 — `src/memory/embedding-provider.ts` (NUEVO)
```typescript
export interface EmbeddingProvider {
  embed(texts: string[]): Promise<number[][]>;
  model: string;
  dimensions: number;
}

// Implementaciones: Gemini, OpenAI, Ollama
export class GeminiEmbeddingProvider implements EmbeddingProvider { ... }
export class OpenAIEmbeddingProvider implements EmbeddingProvider { ... }
export class OllamaEmbeddingProvider implements EmbeddingProvider { ... }
```

#### 3.2 — `src/memory/vector-store.ts` (NUEVO)
```typescript
// SQLite + sqlite-vec para búsqueda vectorial
// Tablas: memory_chunks, memory_embeddings, memory_fts
export class VectorMemoryStore {
  async index(content: string, metadata: ChunkMetadata): Promise<void>;
  async search(query: string, topK?: number): Promise<MemorySearchResult[]>;
  async searchFTS(keywords: string[]): Promise<MemorySearchResult[]>;  // Fallback
  async sync(): Promise<void>;  // Re-indexar archivos cambiados
}
```

#### 3.3 — `src/memory/chunker.ts` (NUEVO)
```typescript
// Dividir documentos en chunks con overlap
export function chunkText(text: string, opts?: {
  maxTokens?: number;   // Default: 512
  overlap?: number;      // Default: 50 tokens
}): TextChunk[];
```

#### 3.4 — Extender `memory-manager.ts`
- Mantener `long_term.json` para hechos rápidos (zero-latency)
- Agregar `VectorMemoryStore` para búsqueda semántica profunda
- Nuevo método: `searchMemory(query): MemorySearchResult[]`
- Indexar automáticamente: chat history, MEMORY.md, archivos de proyecto
- El `ContextEngine` usa `searchMemory()` en `assemble()` para inyectar contexto relevante

#### 3.5 — `data/MEMORY.md` (NUEVO)
Archivo markdown que el usuario puede editar directamente con notas persistentes:
```markdown
# Memory

## Preferencias
- Prefiere TypeScript sobre JavaScript
- Editor: VS Code

## Proyectos
- Orbit: Asistente AI de escritorio
- Stack: Node.js + Electron + Gemini

## Notas
- API key de Notion está en .env
```

---

## FASE 4: Subsystem Logger

### Qué hace OpenClaw
```typescript
// Cada módulo tiene su propio logger con color
const log = createSubsystemLogger('skills');     // 🟢 verde
const log = createSubsystemLogger('context');    // 🔵 azul
const log = createSubsystemLogger('plugins');    // 🟡 amarillo

log.info('Loaded 7 skills');          // [skills] Loaded 7 skills
log.warn('Missing bin: gh');          // [skills] ⚠ Missing bin: gh
log.error('Failed to parse YAML');    // [skills] ❌ Failed to parse YAML

// Filtrado por subsistema en config
logging:
  level: info
  subsystems:
    skills: debug     # Solo skills en debug
    context: warn     # Context solo warnings+
```

### Qué tiene Orbit hoy
- `src/infra/logger.ts`: Logger básico con `createLogger(module)` + niveles

### Qué implementar

#### 4.1 — Extender `src/infra/logger.ts`
```typescript
// Mapa de colores por subsistema
const SUBSYSTEM_COLORS: Record<string, string> = {
  skills: '\x1b[32m',     // verde
  context: '\x1b[34m',    // azul
  plugins: '\x1b[33m',    // amarillo
  memory: '\x1b[35m',     // magenta
  agent: '\x1b[36m',      // cyan
  mcp: '\x1b[31m',        // rojo
  gateway: '\x1b[37m',    // blanco
};

// Filtrado por subsistema desde config
export function createSubsystemLogger(subsystem: string) {
  const level = getConfig().logging?.subsystems?.[subsystem] ?? getConfig().logging?.level ?? 'info';
  return createLogger(subsystem, { level, color: SUBSYSTEM_COLORS[subsystem] });
}
```

#### 4.2 — Redacción centralizada de tokens
```typescript
// En logger.ts: interceptar ANTES de escribir
const TOKEN_PATTERNS = [
  /sk-[a-zA-Z0-9]{20,}/g,           // OpenAI
  /AIza[a-zA-Z0-9_-]{35}/g,         // Google
  /sk-ant-[a-zA-Z0-9_-]{40,}/g,     // Anthropic
  /ghp_[a-zA-Z0-9]{36}/g,           // GitHub
  /xoxb-[a-zA-Z0-9-]+/g,            // Slack
];

function redact(text: string): string {
  let result = text;
  for (const pattern of TOKEN_PATTERNS) {
    result = result.replace(pattern, '[REDACTED]');
  }
  return result;
}
```

---

## FASE 5: Session Key System

### Qué hace OpenClaw
Formato canónico: `agent:<agentId>:<rest>`
- `agent:main:discord:group:123` → Agente main en Discord grupo 123
- `agent:cron-bot:subagent:scheduler` → Sub-agente del cron
- Utilidades: `parseAgentSessionKey()`, `deriveSessionChatType()`, `isSubagentSessionKey()`

### Qué tiene Orbit hoy
- Session ID simple (UUID) en `chat-history.ts`
- Sin concepto de canales o tipos de chat

### Qué implementar

#### 5.1 — `src/sessions/session-key.ts` (NUEVO)
```typescript
export type SessionKey = `orbit:${string}:${string}`;

export function buildSessionKey(parts: {
  agentId?: string;       // Default: "main"
  channel: string;        // "cli" | "web" | "electron" | "discord" | "mcp"
  identifier: string;     // UUID, user ID, thread ID, etc.
}): SessionKey;

export function parseSessionKey(key: SessionKey): {
  agentId: string;
  channel: string;
  identifier: string;
};

export function deriveSessionType(key: SessionKey): 'direct' | 'group' | 'subagent';
```

Esto prepara Orbit para multi-canal: CLI, Web, Electron, MCP, futuros (Discord, Telegram).

---

## FASE 6: Plugin Slots Model

### Qué hace OpenClaw
El registry tiene **slots tipados**:
```typescript
type PluginRegistry = {
  plugins: PluginRecord[];
  tools: PluginToolRegistration[];
  hooks: PluginHookRegistration[];
  channels: PluginChannelRegistration[];
  providers: PluginProviderRegistration[];
  commands: PluginCommandRegistration[];
  services: PluginServiceRegistration[];
  // ...más slots
};
```

Cada slot es un array tipado. Los plugins se registran en los slots que usan. Remover un plugin solo limpia sus entradas de los slots.

### Qué tiene Orbit hoy
- `src/plugins/registry.ts`: Array plano de `OrbitPlugin[]` con lifecycle
- `src/plugins/types.ts`: `OrbitPlugin`, `OrbitToolPlugin`, `OrbitChannelPlugin`

### Qué implementar

#### 6.1 — Extender `src/plugins/types.ts`
```typescript
export interface OrbitPluginRegistry {
  plugins: Map<string, OrbitPluginRecord>;

  // Slots tipados
  tools: OrbitToolRegistration[];
  hooks: OrbitHookRegistration[];
  commands: OrbitCommandRegistration[];
  providers: OrbitProviderRegistration[];
  channels: OrbitChannelRegistration[];
  skills: OrbitSkillRegistration[];

  // Métodos
  register(plugin: OrbitPlugin): void;
  unregister(pluginId: string): void;  // Limpia todos los slots
  getToolsForPlugin(id: string): OrbitToolRegistration[];
  listPlugins(): OrbitPluginRecord[];
}
```

#### 6.2 — Extender `src/plugins/registry.ts`
Migrar de array plano a slots. Cada plugin registra qué provee:
```typescript
// Plugin al registrarse declara:
{
  id: 'browser',
  tools: [browserControlTool, ...],
  hooks: [{ event: 'before_navigate', handler: ... }],
  commands: [{ name: '/browse', handler: ... }],
}
```

---

## FASE 7: Mejoras Menores (P2)

### 7.1 — Config Refresh Handlers
En `src/config/config.ts`, agregar:
```typescript
const refreshHandlers: Array<(newConfig: OrbitConfig) => void> = [];

export function onConfigRefresh(handler: (cfg: OrbitConfig) => void): void {
  refreshHandlers.push(handler);
}

export async function refreshConfig(): Promise<void> {
  configCache = null;
  const cfg = await getConfig();
  refreshHandlers.forEach(h => h(cfg));
}
```

### 7.2 — Hook System mejorado
En `src/hooks/`, agregar eventos:
- `session:start`, `session:end`
- `turn:before`, `turn:after`
- `tool:before`, `tool:after`
- `compact:start`, `compact:done`
- `memory:updated`

### 7.3 — Skill Creator Skill
Basado en el `skill-creator` de OpenClaw, agregar `skills/skill-creator/SKILL.md` que enseña a Orbit cómo crear nuevas skills.

---

## Orden de Implementación Recomendado

```
SPRINT 1 (Fundamentos):
  ├─ 4. Subsystem Logger (base para todo debugging)
  ├─ 2. Skills v2 — requires system
  └─ 7.2 Config Refresh Handlers

SPRINT 2 (Cerebro):
  ├─ 1. Context Engine
  ├─ 5. Session Key System
  └─ 7.1 Hook System

SPRINT 3 (Memoria):
  ├─ 3. Memory con Embeddings
  └─ MEMORY.md support

SPRINT 4 (Arquitectura):
  ├─ 6. Plugin Slots Model
  └─ 7.3 Skill Creator
```

---

## Archivos de OpenClaw para Referencia

| Concepto | Archivo OpenClaw | Destino Orbit |
|----------|-----------------|---------------|
| Context Engine interface | `src/context-engine/types.ts` | `src/context/context-engine.ts` |
| Context Registry | `src/context-engine/registry.ts` | `src/context/registry.ts` |
| Default Engine | `src/context-engine/legacy.ts` | `src/context/default-engine.ts` |
| Skill requires | `skills/github/SKILL.md` frontmatter | `src/skills/eligibility.ts` |
| Skill creator | `skills/skill-creator/SKILL.md` | `skills/skill-creator/SKILL.md` |
| Memory schema | `packages/memory-host-sdk/host/memory-schema.ts` | `src/memory/vector-store.ts` |
| Chunker | `packages/memory-host-sdk/host/internal.ts` | `src/memory/chunker.ts` |
| Query expansion | `packages/memory-host-sdk/host/query-expansion.ts` | `src/memory/query-expansion.ts` |
| Subsystem logger | `src/logging/subsystem.ts` | `src/infra/logger.ts` |
| Session keys | `src/sessions/session-key-utils.ts` | `src/sessions/session-key.ts` |
| Plugin registry | `src/plugins/registry.ts` | `src/plugins/registry.ts` |
| Plugin manifest | `src/plugins/manifest.ts` | `src/plugins/types.ts` |
| Error redaction | `src/infra/errors.ts` | `src/infra/logger.ts` |
| Hook system | `src/hooks/internal-hooks.ts` | `src/hooks/runner.ts` |

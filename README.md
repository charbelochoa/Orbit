# Orbit AI v2.0 — Desktop Assistant

Orbit es un asistente de escritorio con IA que combina un chat conversacional con capacidades reales: búsqueda web, control del computador, gestión de archivos, ejecución de comandos y más.

## Arquitectura

```
┌─────────────────────────────────────────────────────────┐
│  Electron Window (--no-sandbox)                         │
│  ┌────────────────────┐  ┌──────────────────────────┐  │
│  │  Chat UI (port 3000)│  │  Overlay Orb (transparent)│  │
│  └────────────────────┘  └──────────────────────────┘  │
└──────────────────┬──────────────────────────────────────┘
                   │ WebSocket ws://localhost:18789
┌──────────────────▼──────────────────────────────────────┐
│  Gateway (src/gateway/server.ts)                        │
│  Rate limiter · Command router · Event broadcaster      │
└──────────────────┬──────────────────────────────────────┘
                   │
       ┌───────────┴────────────┐
       │                        │
┌──────▼─────┐          ┌──────▼──────────────────────────┐
│ Gemini Live │          │  Agent Pipeline                  │
│  (voice +  │          │  Planner → Executor (waves)      │
│   text)    │          │  Skills · Plugins · Sub-agents   │
└──────┬─────┘          └──────┬──────────────────────────┘
       │                       │
       └──────────┬────────────┘
                  │
┌─────────────────▼───────────────────────────────────────┐
│  Action Layer                                           │
│  web_search · browser · computer · file · cmd · vision  │
└─────────────────────────────────────────────────────────┘
```

## Setup

### Requisitos

- Node.js 20+
- Python 3.10+ (para el motor de visión)
- Gemini API Key

### Instalación

```bash
# 1. Clonar y entrar al directorio
cd Orbit

# 2. Instalar dependencias de Node
npm install

# 3. Configurar variables de entorno
cp .env.example .env
# Editar .env y añadir tu GEMINI_API_KEY

# 4. (Opcional) Instalar dependencias del motor Python
cd engine && pip install -r requirements.txt && cd ..
```

### Variables de entorno (.env)

```env
GEMINI_API_KEY=tu_clave_aqui
OPENAI_API_KEY=opcional
ANTHROPIC_API_KEY=opcional
ORBIT_LOG_LEVEL=info
```

### Configuración (config/orbit.yaml)

```yaml
server:
  webPort: 3000
  wsPort: 18789

providers:
  default: gemini

memory:
  path: data/memory/long_term.json
```

## Uso

### Modo desarrollo

```bash
npm run dev
# o con hot-reload:
npm run dev:watch
```

### Modo Electron (escritorio)

```bash
npm run electron
```

### Verificar compilación TypeScript

```bash
npx tsc --noEmit
```

## Comandos de chat

| Comando | Descripción |
|---------|-------------|
| `/task <objetivo>` | Crea y ejecuta una tarea multi-paso |
| `/memory` | Muestra datos guardados en memoria |
| `/skills` | Lista skills disponibles |
| `/status` | Estado del sistema y proveedor activo |
| `/model <id>` | Cambia proveedor (gemini/openai/anthropic/ollama) |
| `/cancel <id>` | Cancela una tarea en ejecución |
| `/daemon status\|install\|uninstall` | Gestiona autostart de Windows |
| `/clear` | Limpia el historial de chat |
| `/help` | Muestra todos los comandos |

## Autostart en Windows

```bash
# Instalar como servicio de Windows (Task Scheduler)
npm run orbit:install

# Verificar estado
npm run orbit:status

# Ver logs
npm run orbit:logs

# Desinstalar
npm run orbit:uninstall
```

## Endpoints HTTP

| Endpoint | Descripción |
|----------|-------------|
| `GET /` | Dashboard web (chat UI) |
| `GET /health` | Health check (JSON: status, uptime, timestamp) |

## Estructura del proyecto

```
src/
├── index.ts              # Entry point
├── actions/              # Herramientas de acción
│   ├── browser-control   # Control de navegador
│   ├── cmd-control       # Ejecución de comandos (con safety hook)
│   ├── computer-control  # Control del ratón/teclado
│   ├── file-controller   # Operaciones de archivos
│   ├── screen-vision     # Captura y análisis de pantalla
│   └── web-search        # Búsqueda web
├── agent/                # Motor del agente
│   ├── executor          # Ejecución paralela por waves
│   ├── planner           # Planificación de tareas
│   ├── task-queue        # Cola de tareas persistente
│   └── subagent-registry # Sub-agentes paralelos
├── auto-reply/           # Sistema de comandos /cmd
├── core/                 # Prompt, tool-registry, voice
├── daemon/               # Autostart en Windows
├── gateway/              # WebSocket gateway + rate limiting
├── memory/               # Memoria a largo plazo + auto-save
├── plugins/              # Sistema de plugins
├── providers/            # Multi-provider (Gemini/OpenAI/Anthropic/Ollama)
├── skills/               # Sistema de skills (SKILL.md)
└── ui/                   # Web UI y web server

skills/                   # Skill definitions (SKILL.md files)
├── web-research/
├── coding/
├── file-ops/
├── windows-control/
├── browser-automation/
├── github/
├── notion/
└── spotify/
```

## Seguridad

- **Safety hook**: `cmd-control` bloquea comandos destructivos (`rm -rf`, `format`, `shutdown`, etc.)
- **Path traversal**: El web server previene acceso fuera de `src/ui/web/`
- **Rate limiting**: El gateway limita a 40 mensajes/minuto por cliente
- **Sanitización**: El UI usa DOMPurify antes de renderizar markdown

## Licencia

MIT

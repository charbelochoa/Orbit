# Plan de Implementación: Orbit + Mark-XXXV
**Objetivo:** Hacer Orbit plenamente funcional y autónomo incorporando los componentes probados de Mark-XXXV
**Fecha:** 30 de marzo de 2026

---

## Diagnóstico Comparativo

### Mark-XXXV (Referencia)
| Capa | Implementación | Calidad |
|------|---------------|---------|
| **Cerebro** | Gemini 2.5 Flash Native Audio + planner/executor/error-handler con LLM |  Completo |
| **Ojos** | mss + Gemini Vision en sesión Live separada + OpenCV webcam |  Completo |
| **Manos** | PyAutoGUI + Playwright + 18 herramientas especializadas |  Completo |
| **Memoria** | JSON 6 categorías + extracción LLM 2 etapas |  Completo |
| **Agente** | Planner → Executor (context injection) → Error Handler LLM → Replan |  Completo |

### Orbit (Estado Actual)
| Capa | Implementación | Problema |
|------|---------------|---------|
| **Cerebro** | Gemini Live WebSocket raw, voz Aoede |  Conectado pero frágil |
| **Ojos** | screenshot-desktop → Gemini multimodal + YOLO sidecar |  YOLO model vacío, cámara = stub |
| **Manos** | C# P/Invoke Bézier + Puppeteer + 13 tools |  Faltan 8 tools de Mark |
| **Memoria** | JSON 4 categorías + SQLite historial |  Historial NUNCA inyectado en Gemini |
| **Agente** | Planner→Executor→ErrorHandler |  ErrorHandler desconectado, sin LLM, sin context injection |
| **UI** | Electron overlay + Web SPA |  Mejor que Mark |

### Ventajas de Orbit sobre Mark que CONSERVAR
- Electron overlay pixel-art (única a Orbit)
- Motor Bézier C# P/Invoke (más preciso que PyAutoGUI)
- YOLO sidecar para detección de elementos UI
- SQLite para historial (más robusto que JSON)
- Web SPA + WebSocket para control remoto
- TypeScript (tipado fuerte, mejor tooling)

---

## Fases de Implementación

---

### FASE 1 — Reparar el Loop del Agente (CRÍTICO)
**Prioridad:**  Alta | **Archivos:** `src/agent/`

El agente es el cerebro táctico de Orbit. Sin él funcionando correctamente, Orbit no puede ejecutar tareas multi-paso.

#### 1.1 — Conectar `error-handler` al `executor`
**Archivo:** `src/agent/executor.ts`

**Problema:** El executor rompe el bucle al primer fallo con `break`. Nunca llama a `analyzeError()`.

**Cambio:**
```typescript
// ANTES (executor.ts ~línea 45):
if (!result.success) {
  errors.push(result.error || 'Unknown error');
  break;  // ← SE DETIENE AQUÍ
}

// DESPUÉS:
if (!result.success) {
  const decision = await analyzeError(step.tool, result.error || '', attempt);
  
  if (decision.action === 'RETRY' && attempt < 3) {
    attempt++;
    continue;  // reintenta el mismo paso
  } else if (decision.action === 'REPLAN') {
    const newPlan = await replan(goal, remainingSteps, result.error);
    // reemplaza los pasos restantes con el nuevo plan
    steps.splice(i, steps.length - i, ...newPlan.steps);
    break; // sale del loop actual, reinicia con nuevo plan
  } else if (decision.action === 'ABORT') {
    return { success: false, error: `Aborted: ${result.error}` };
  }
  // SKIP: continua al siguiente paso
  errors.push(result.error || 'Unknown error');
}
```

#### 1.2 — Upgrade de `error-handler` a LLM (como Mark)
**Archivo:** `src/agent/error-handler.ts`

**Problema:** Usa 5 patrones regex. Errores desconocidos siempre resultan en SKIP después de 3 intentos.

**Cambio:** Replicar el patrón de `Mark/agent/error_handler.py`:
```typescript
// Añadir función LLM a error-handler.ts
async function analyzeErrorWithLLM(tool: string, error: string): Promise<ErrorDecision> {
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  const prompt = `Eres un optimizador de agente IA. Un paso falló:
  - Herramienta: ${tool}
  - Error: ${error}
  
  Decide: RETRY (error transitorio), SKIP (paso no crítico), REPLAN (enfoque diferente), ABORT (imposible continuar)
  
  Responde SOLO con JSON: {"action": "RETRY|SKIP|REPLAN|ABORT", "reason": "..."}`;
  
  const response = await ai.models.generateContent({...});
  return JSON.parse(response.text);
}

// Modificar analyzeError() para usar LLM como fallback:
export async function analyzeError(tool, error, attempt) {
  const regexResult = matchRegexPattern(error); // lógica actual
  if (regexResult) return regexResult;
  
  // Nuevo: fallback LLM para errores desconocidos
  return await analyzeErrorWithLLM(tool, error);
}
```

#### 1.3 — Context Injection entre pasos (como Mark `_inject_context`)
**Archivo:** `src/agent/executor.ts`

**Problema:** Los pasos son independientes. Si el paso 1 busca información y el paso 2 debe escribirla en un archivo, el paso 2 no recibe la información.

**Cambio:**
```typescript
// Añadir al executor tras cada paso exitoso:
const stepResults: Record<string, string> = {};

// Al completar paso:
stepResults[step.tool] = result.output;

// Al preparar siguiente paso — inyectar contexto:
function injectContext(step: PlanStep, previousResults: Record<string, string>): PlanStep {
  if (step.tool === 'file_controller' && step.args.action === 'write') {
    if (!step.args.content && previousResults['web_search']) {
      step.args.content = previousResults['web_search'];
    }
  }
  // Patrón general: reemplazar placeholders {{step_N_result}}
  const argsStr = JSON.stringify(step.args);
  const injected = argsStr.replace(/\{\{(\w+)_result\}\}/g, 
    (_, key) => previousResults[key] || '');
  return { ...step, args: JSON.parse(injected) };
}
```

#### 1.4 — Resumen final del agente (como Mark `_summarize`)
**Archivo:** `src/agent/executor.ts`

**Cambio:** Al terminar la ejecución, generar una frase natural con Gemini describiendo lo que se logró y emitirla via WebSocket para que la UI la muestre y Gemini la vocalice.

---

### FASE 2 — Portar las Acciones Faltantes de Mark
**Prioridad:**  Alta | **Archivos:** `src/actions/`

Orbit tiene 13 tools. Mark tiene 18+. Estos son los módulos que faltan:

#### 2.1 — `computer-settings.ts` (Volumen, Brillo, Ventanas)
**Origen:** `Mark/actions/computer_settings.py`
**Archivo nuevo:** `src/actions/computer-settings.ts`

Implementar via PowerShell (ya disponible en Orbit via `cmd-control.ts`):
```typescript
// Volumen via PowerShell (nircmd o Set-MasterVolume)
export async function computerSettings(args: { action: string, value?: number }) {
  const commands = {
    'volume_up':   `(Get-AudioDevice -Playback).Volume + 10 | Set-AudioDevice -Volume`,
    'volume_down': `...`,
    'volume_set':  `nircmd.exe setsysvolume ${Math.round((args.value||50)/100 * 65535)}`,
    'brightness_up':   `(Get-Brightness) + 10 | Set-Brightness`,
    'mute':        `nircmd.exe mutesysvolume 1`,
    'unmute':      `nircmd.exe mutesysvolume 0`,
    // Windows snapping via PowerShell Window Management
    'snap_left':   `Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait('%+{LEFT}')`,
    'minimize':    `...`,
    'close_app':   `Stop-Process -Name ${args.app} -Force`,
  };
  // Intent detection si la acción no es exacta → Gemini decide el commando
}
```

**Registrar en `tool-registry.ts` y `actions/index.ts`.**

#### 2.2 — `open-app.ts` (Lanzador de Aplicaciones)
**Origen:** `Mark/actions/open_app.py`
**Archivo nuevo:** `src/actions/open-app.ts`

```typescript
const APP_ALIASES: Record<string, string> = {
  'chrome': 'Google Chrome',
  'edge': 'Microsoft Edge', 
  'vscode': 'Visual Studio Code',
  'notepad': 'notepad',
  'discord': 'Discord',
  'spotify': 'Spotify',
  // ... ~30 más
};

export async function openApp(args: { app: string }) {
  const appName = APP_ALIASES[args.app.toLowerCase()] || args.app;
  // Método 1: Tecla Win → escribe nombre → Enter (como Mark)
  // Método 2: Start-Process si falla
  await computerControl({ action: 'hotkey', keys: ['win'] });
  await sleep(500);
  await computerControl({ action: 'type', text: appName });
  await sleep(800);
  await computerControl({ action: 'press', key: 'enter' });
}
```

**Registrar en tool-registry y router.**

#### 2.3 — `code-helper.ts` (Escribir y Ejecutar Código)
**Origen:** `Mark/actions/code_helper.py`
**Archivo nuevo:** `src/actions/code-helper.ts`

Capacidades:
- Escribir código (Python/JS/TS/PS1) con Gemini → guardar en archivo
- Ejecutar el archivo con timeout
- Loop de corrección: ejecuta → si falla → Gemini genera fix → reintenta (3 veces)
- Explicar código existente
- Depurar código con análisis de error

```typescript
export async function codeHelper(args: { 
  action: 'write'|'run'|'fix'|'explain', 
  language?: string,
  task?: string,
  file_path?: string 
}) {
  if (args.action === 'write') {
    // Gemini genera código → escribe en temp file → retorna path
  }
  if (args.action === 'run') {
    // Ejecuta el archivo, captura stdout/stderr con timeout 30s
  }
  // Loop write→run→fix integrado para acción 'write' con auto_run=true
}
```

#### 2.4 — `send-message.ts` (Mensajería)
**Origen:** `Mark/actions/send_message.py`
**Archivo nuevo:** `src/actions/send-message.ts`

- WhatsApp Web via browser-control (ya disponible): abrir wa.me/{número} → escribir mensaje → Enter
- Telegram Web via browser-control
- Funciona con los módulos existentes de Orbit (no requiere PyAutoGUI)

#### 2.5 — `reminder.ts` (Recordatorios)
**Origen:** `Mark/actions/reminder.py`
**Archivo nuevo:** `src/actions/reminder.ts`

Via PowerShell (ya disponible):
```typescript
// Crear tarea en Windows Task Scheduler
const ps = `Register-ScheduledTask -TaskName "${name}" -Trigger (New-ScheduledTaskTrigger -At "${datetime}" -Once) -Action (New-ScheduledTaskAction -Execute "powershell" -Argument "-Command \\"[System.Reflection.Assembly]::LoadWithPartialName('System.Windows.Forms'); [System.Windows.Forms.MessageBox]::Show('${message}', 'Orbit Reminder')\\"")`;
```

Registrar en tool-registry.

---

### FASE 3 — Reparar el Sistema de Visión
**Prioridad:**  Media | **Archivos:** `src/actions/screen-vision.ts`, `engine/`

#### 3.1 — Arreglar cámara webcam en `screen-vision.ts`
**Problema:** `camera` devuelve `{ success: false, error: 'Webcam capture not supported' }`.

**Solución A (sin Python):** Usar PowerShell + DirectShow / MediaFoundation para snapshot de cámara.

**Solución B (con Python engine):** Añadir endpoint `/camera` al `orbit_engine.py` con OpenCV (ya disponible en engine), igual que `Mark/actions/screen_processor.py`:
```python
# En orbit_engine.py → agregar handler /camera
def handle_camera(self):
    cap = cv2.VideoCapture(self._get_camera_index())
    ret, frame = cap.read()
    cap.release()
    _, buffer = cv2.imencode('.jpg', frame, [cv2.IMWRITE_JPEG_QUALITY, 60])
    return base64.b64encode(buffer).decode()
```

**En `screen-vision.ts`:**
```typescript
if (args.source === 'camera') {
  const response = await fetch('http://localhost:18790/camera');
  const { image_base64 } = await response.json();
  // enviar a Gemini multimodal igual que screenshot
}
```

#### 3.2 — Auto-detección de índice de cámara (como Mark)
Replicar lógica de `_get_camera_index()` de Mark en `orbit_engine.py`:
```python
def _get_camera_index(self):
    if self._camera_index is not None:
        return self._camera_index
    for i in range(6):
        cap = cv2.VideoCapture(i, cv2.CAP_DSHOW)
        if cap.isOpened():
            ret, frame = cap.read()
            if ret and frame.mean() > 5:
                cap.release()
                self._camera_index = i
                return i
        cap.release()
    return 0
```

#### 3.3 — Activar YOLO model o proveer fallback
**Problema:** `engine/models/` está vacío → `vision_detect/click/type` fallan.

**Solución inmediata:** Añadir fallback en `orbit_engine.py` cuando no hay modelo:
```python
if not os.path.exists(MODEL_PATH):
    # Fallback: usar screenshot + Gemini Vision para detección
    # Retornar bounding boxes aproximados via análisis de imagen
    return self.fallback_vision_detect(query)
```

**Solución a largo plazo:** Entrenar/descargar `orbit_master_v1.pt` con los 3 elementos UI (button, text_field, icon).

---

### FASE 4 — Reparar Memoria e Historial
**Prioridad:**  Media | **Archivos:** `src/memory/`, `src/index.ts`

#### 4.1 — Inyectar historial de chat en contexto de Gemini
**Problema:** `chat-history.ts` guarda mensajes pero `index.ts` NUNCA llama `getHistory()`.

**Archivo:** `src/index.ts`

**Cambio:**
```typescript
// En la función que construye el mensaje de turno de usuario:
const history = chatHistory.getHistory(20); // últimos 20 mensajes
const historyContext = history.map(m => `${m.role}: ${m.content}`).join('\n');

// Añadir al system prompt o como turns previos:
// Opción más correcta: enviar como turns history via Gemini Live API
// send_client_content con history turns antes del input del usuario
```

#### 4.2 — Expandir categorías de memoria (de 4 a 6 como Mark)
**Archivo:** `src/memory/memory-manager.ts`

**Añadir:**
```typescript
interface LongTermMemory {
  identity: {...},
  preferences: {...},
  relationships: {...},  // ← Contactos, personas importantes
  notes: {...},
  projects: {...},       // ← NUEVO: proyectos en progreso
  wishes: {...}          // ← NUEVO: cosas que el usuario quiere hacer
}
```

Actualizar el prompt de extracción para incluir las nuevas categorías.

#### 4.3 — Persistir memoria en ruta más robusta
**Cambio:** Mover de `data/memory/long_term.json` a `%APPDATA%/Orbit/memory/long_term.json` para que sobreviva reinstalaciones.

---

### FASE 5 — Feedback en Tiempo Real al UI
**Prioridad:**  Media | **Archivos:** `src/gateway/server.ts`, `src/index.ts`, `src/agent/executor.ts`

#### 5.1 — Conectar `setTypingState` al flujo real
**Problema:** `setTypingState()` está definida en `server.ts` pero NUNCA es llamada desde `index.ts`.

**Cambio en `src/index.ts`:**
```typescript
// Antes de ejecutar una tool:
setTypingState(true, toolName);

// Después de ejecutar:
setTypingState(false);

// Broadcast resultado de tool al UI:
broadcast({ type: 'tool_result', tool: toolName, result: result.output, success: result.success });
```

#### 5.2 — Progreso de tareas multi-paso al UI
**Archivo:** `src/agent/executor.ts`

**Cambio:** Emitir eventos de progreso durante la ejecución del agente:
```typescript
// Al iniciar cada paso:
broadcast({ type: 'task_progress', step: i+1, total: steps.length, tool: step.tool, description: step.description });

// Al completar:
broadcast({ type: 'task_complete', summary: summaryText });

// Al fallar:
broadcast({ type: 'task_error', step: i+1, error: errorMessage, action: errorDecision.action });
```

#### 5.3 — Panel de progreso en la Web UI
**Archivo:** `src/ui/web/index.html`

**Añadir** en el sidebar (ya tiene pestañas Tareas/Memoria) un feed de progreso en tiempo real:
- Indicador de pasos: "Paso 2/4: Buscando información..."
- Código de color por tool
- Spinner mientras ejecuta

---

### FASE 6 — Estabilidad y Reconexión
**Prioridad:**  Baja | **Archivos:** `src/index.ts`

#### 6.1 — Reconexión robusta de Gemini Live
**Problema:** La reconexión existe pero no preserva el contexto entre sesiones.

**Mejora:** Al reconectar, reinyectar el system prompt con memoria actualizada (como Mark reconstruye `_build_config()` en cada reconexión).

#### 6.2 — Heartbeat de la sesión Python engine
**Cambio:** Monitorear que el proceso `orbit_engine.py` sigue vivo:
```typescript
setInterval(async () => {
  try {
    await fetch('http://localhost:18790/status');
  } catch {
    // Relanzar el proceso Python
    spawnPythonEngine();
  }
}, 30_000);
```

---

### FASE 7 — Nuevas Capacidades Avanzadas (POST-CORE)
**Prioridad:**  Opcional (después de fases 1-6)

#### 7.1 — `dev-agent.ts` (Crear Proyectos Completos)
**Origen:** `Mark/actions/dev_agent.py`

Capacidades:
- Recibe objetivo ("crea una app web de lista de tareas")
- Genera árbol de archivos con Gemini
- Escribe cada archivo en orden de dependencias
- Instala deps (npm/pip/etc.)
- Ejecuta el proyecto
- Loop de corrección (5 intentos)

#### 7.2 — `youtube-video.ts` (YouTube)
**Origen:** `Mark/actions/youtube_video.py`

- Buscar y reproducir videos en el navegador por defecto
- Transcripciones via `youtube-transcript-api` (Python endpoint en orbit_engine)
- Trending topics

#### 7.3 — Integración de Voz Bidireccional Mejorada
**Problema actual:** `voice.ts` (GeminiLiveClient) está implementado pero no usado.

**Opción:** Migrar la lógica de WebSocket crudo de `index.ts` a usar `GeminiLiveClient` de `voice.ts` — menos código, más mantenible.

---

## Orden de Ejecución Recomendado

```
Semana 1 — Core Funcional
├── Fase 1.1: Conectar error-handler al executor     (2h)
├── Fase 1.2: Upgrade error-handler a LLM            (3h)
├── Fase 1.3: Context injection entre pasos          (3h)
├── Fase 1.4: Resumen final del agente               (1h)
└── Fase 4.1: Inyectar historial en Gemini           (2h)

Semana 2 — Acciones Completas
├── Fase 2.1: computer-settings.ts                  (3h)
├── Fase 2.2: open-app.ts                           (2h)
├── Fase 2.3: code-helper.ts                        (4h)
├── Fase 2.4: send-message.ts                       (2h)
└── Fase 2.5: reminder.ts                           (2h)

Semana 3 — Visión y Memoria
├── Fase 3.1: Cámara webcam en engine               (3h)
├── Fase 3.2: Auto-detección índice cámara          (1h)
├── Fase 3.3: Fallback YOLO → Gemini Vision         (4h)
├── Fase 4.2: Expandir categorías de memoria        (2h)
└── Fase 4.3: Ruta persistente de memoria           (1h)

Semana 4 — UI y Estabilidad
├── Fase 5.1: Conectar setTypingState               (1h)
├── Fase 5.2: Progreso de tareas al UI              (3h)
├── Fase 5.3: Panel de progreso en Web UI           (4h)
├── Fase 6.1: Reconexión robusta                    (2h)
└── Fase 6.2: Heartbeat Python engine               (1h)
```

---

## Detalles de Implementación por Archivo

### Archivos a MODIFICAR
| Archivo | Cambio | Fase |
|---------|--------|------|
| `src/agent/executor.ts` | Conectar error-handler + context injection + resumen | 1.1, 1.3, 1.4 |
| `src/agent/error-handler.ts` | Añadir LLM fallback | 1.2 |
| `src/index.ts` | Historial → Gemini + feedback de tools + heartbeat engine | 4.1, 5.1, 6.2 |
| `src/memory/memory-manager.ts` | +2 categorías (projects, wishes) | 4.2 |
| `src/core/tool-registry.ts` | Añadir 5 nuevas tools | 2.x |
| `src/actions/index.ts` | Router para 5 nuevas tools | 2.x |
| `src/core/prompt.ts` | Documentar nuevas capacidades | 2.x |
| `src/gateway/server.ts` | Broadcast tool events | 5.1 |
| `engine/orbit_engine.py` | Endpoint /camera + fallback YOLO + heartbeat | 3.1, 3.2, 3.3 |
| `src/ui/web/index.html` | Panel progreso tareas | 5.3 |

### Archivos a CREAR
| Archivo | Descripción | Fase |
|---------|-------------|------|
| `src/actions/computer-settings.ts` | Volumen, brillo, ventanas via PowerShell | 2.1 |
| `src/actions/open-app.ts` | Lanzador de aplicaciones | 2.2 |
| `src/actions/code-helper.ts` | Escribir/ejecutar/depurar código | 2.3 |
| `src/actions/send-message.ts` | WhatsApp/Telegram via browser | 2.4 |
| `src/actions/reminder.ts` | Recordatorios via Task Scheduler | 2.5 |

---

## Dependencias Python a Añadir (`engine/requirements.txt`)
```
# Ya existentes:
ultralytics
pyautogui
mss
opencv-python
pillow
numpy

# AÑADIR para nuevas funciones:
comtypes          # Control de volumen Windows via COM (como Mark)
pycaw             # Volumen preciso en dB (como Mark)
```

## Dependencias Node a Añadir (`package.json`)
```json
{
  "youtube-transcript": "^1.2.3"
}
```
*(Para fase 7.2 — youtube)*

---

## Notas de Arquitectura

### Por qué NO portar todo de Mark directamente
1. **PyAutoGUI vs C# P/Invoke**: El motor de movimiento de Orbit (Bézier + DPI-aware) es SUPERIOR al PyAutoGUI de Mark. No sustituir.
2. **Playwright vs Puppeteer**: Mark usa Playwright, Orbit usa Puppeteer-core. Ambos son válidos; Puppeteer ya funciona en Orbit, no migrar.
3. **Tkinter vs Electron**: La UI de Orbit (Electron + overlay pixel-art) es SUPERIOR. Mantener.
4. **YOLO vs Gemini Vision**: Orbit tiene AMBOS. Estrategia: usar YOLO para detección rápida de elementos, Gemini para comprensión semántica de la pantalla.

### Patrón de integración de Mark → Orbit
```
Mark Python → Puerto desde Python a TypeScript
                    ↓
            Si usa PyAutoGUI → usar computer-control.ts existente
            Si usa subprocess → usar cmd-control.ts existente
            Si usa Playwright → adaptar a puppeteer-core
            Si usa Gemini API → usar @google/genai (ya disponible)
            Si usa OpenCV → añadir endpoint a orbit_engine.py
```

### Estado final esperado de Orbit tras todas las fases
```
┌──────────────────────────────────────────────────────────────┐
│                     ORBIT FINAL STATE                        │
│                                                              │
│  VOZ ──→ Gemini Live 2.0 Flash ──→ RESPUESTA AUDIO/TEXTO     │
│               │                                              │
│               ↓ Tool Call                                    │
│    ┌──────────────────────┐    ┌────────────────────────┐   │
│    │  ACCIÓN DIRECTA      │    │  AGENTE MULTI-PASO     │   │
│    │  (13 tools base      │    │  Planner → Executor    │   │
│    │   + 5 nuevas)        │    │  + ErrorHandler LLM    │   │
│    │                      │    │  + Context Injection   │   │
│    │  OJOS:               │    │  + Replan on fail      │   │
│    │  · screenshot+Gemini │    └────────────────────────┘   │
│    │  · YOLO detection    │                                  │
│    │  · Webcam (nuevo)    │    ┌────────────────────────┐   │
│    │                      │    │  MEMORIA               │   │
│    │  MANOS:              │    │  · SQLite historial    │   │
│    │  · C# Bézier mouse   │    │  · JSON 6 categorías   │   │
│    │  · Puppeteer browser │    │  · Inyectada en Gemini │   │
│    │  · PowerShell cmd    │    └────────────────────────┘   │
│    │  · Settings (nuevo)  │                                  │
│    │  · Open App (nuevo)  │    ┌────────────────────────┐   │
│    │  · Code Helper(nuevo)│    │  UI ELECTRON           │   │
│    │  · Messages (nuevo)  │    │  · Overlay orb         │   │
│    │  · Reminders (nuevo) │    │  · Web SPA + progreso  │   │
│    └──────────────────────┘    │  · System tray         │   │
│                                └────────────────────────┘   │
└──────────────────────────────────────────────────────────────┘
```

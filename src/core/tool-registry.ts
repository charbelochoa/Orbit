/**
 * Tool declarations sent to Gemini Live API.
 * Every tool here must have a corresponding case in actions/index.ts.
 */
export const TOOL_DECLARATIONS = [

    // ── Open any app ────────────────────────────────────────────────────────
    {
        name: "open_app",
        description: "Abre cualquier aplicación en el ordenador Windows. Úsalo cuando el usuario pida abrir, lanzar o iniciar cualquier app, sitio web o programa. Conoce ~50 apps por alias (chrome, vscode, discord, spotify, etc.).",
        parameters: {
            type: "OBJECT",
            properties: {
                app_name: { type: "STRING", description: "Nombre de la aplicación (ej. 'WhatsApp', 'Chrome', 'Spotify', 'Notepad', 'Discord')" }
            },
            required: ["app_name"]
        }
    },

    // ── Computer settings (volume, brightness, windows) ─────────────────
    {
        name: "computer_settings",
        description: "Controla ajustes del sistema: volumen (subir/bajar/mutear/fijar), brillo, cerrar apps, minimizar/maximizar ventanas, snap left/right, mostrar escritorio, pantalla completa. Acepta acción directa o texto natural.",
        parameters: {
            type: "OBJECT",
            properties: {
                action: {
                    type: "STRING",
                    description: "volume_up | volume_down | volume_mute | volume_set | brightness_up | brightness_down | brightness_set | close_app | minimize | maximize | snap_left | snap_right | show_desktop | switch_window | full_screen"
                },
                value: { type: "INTEGER", description: "Valor numérico (porcentaje para volumen/brillo, cantidad para subir/bajar)" },
                app:   { type: "STRING",  description: "Nombre de app para close_app" },
                task:  { type: "STRING",  description: "Texto natural si no sabes la acción exacta (ej. 'baja el volumen a la mitad')" }
            },
            required: []
        }
    },

    // ── Code helper ─────────────────────────────────────────────────────────
    {
        name: "code_helper",
        description: "Genera, ejecuta, corrige y explica código. Soporta Python, JavaScript, TypeScript, PowerShell, Batch. Loop automático write→run→fix (3 intentos). Úsalo cuando el usuario pida escribir scripts, código, o ejecutar algo programático.",
        parameters: {
            type: "OBJECT",
            properties: {
                action:    { type: "STRING", description: "write | run | fix | explain" },
                task:      { type: "STRING", description: "Descripción de lo que debe hacer el código (para write)" },
                language:  { type: "STRING", description: "python | javascript | typescript | powershell | batch (default: python)" },
                file_path: { type: "STRING", description: "Ruta del archivo (para run/fix/explain)" },
                auto_run:  { type: "BOOLEAN", description: "Si true (default), ejecuta tras generar (para write)" }
            },
            required: ["action"]
        }
    },

    // ── Send message ─────────────────────────────────────────────────────────
    {
        name: "send_message",
        description: "Envía mensajes por WhatsApp Web o Telegram Web usando el navegador. Puede enviar a un número de teléfono o buscar un contacto por nombre.",
        parameters: {
            type: "OBJECT",
            properties: {
                platform: { type: "STRING", description: "whatsapp | telegram (default: whatsapp)" },
                contact:  { type: "STRING", description: "Número de teléfono (con código de país) o nombre del contacto" },
                message:  { type: "STRING", description: "El mensaje a enviar" }
            },
            required: ["contact", "message"]
        }
    },

    // ── Reminder ─────────────────────────────────────────────────────────────
    {
        name: "reminder",
        description: "Crea, lista o elimina recordatorios usando Windows Task Scheduler. Los recordatorios aparecen como popup en la hora indicada.",
        parameters: {
            type: "OBJECT",
            properties: {
                action:   { type: "STRING", description: "create | list | delete (default: create)" },
                message:  { type: "STRING", description: "Texto del recordatorio (para create)" },
                datetime: { type: "STRING", description: "Fecha/hora: 'YYYY-MM-DD HH:mm' o 'HH:mm' para hoy (para create)" },
                name:     { type: "STRING", description: "Nombre identificador del recordatorio (para delete)" },
                all:      { type: "BOOLEAN", description: "true para eliminar todos los recordatorios (para delete)" }
            },
            required: []
        }
    },

    // ── Web search ───────────────────────────────────────────────────────────
    {
        name: "web_search",
        description: "Busca información en internet. Úsalo para noticias, precios, datos actuales, preguntas generales. Devuelve una respuesta resumida con fuentes.",
        parameters: {
            type: "OBJECT",
            properties: {
                query: { type: "STRING", description: "Consulta de búsqueda en lenguaje natural" },
                mode:  { type: "STRING", description: "search (por defecto) | compare" }
            },
            required: ["query"]
        }
    },

    // ── Weather ──────────────────────────────────────────────────────────────
    {
        name: "weather_report",
        description: "Obtiene el clima actual de una ciudad.",
        parameters: {
            type: "OBJECT",
            properties: {
                city: { type: "STRING", description: "Nombre de la ciudad" }
            },
            required: ["city"]
        }
    },

    // ── Computer control (PowerShell-based, Bézier mouse) ────────────────────
    {
        name: "computer_control",
        description: "Control directo del ordenador: escribir texto, hacer click (movimiento natural Bézier), doble click, click derecho, teclas, atajos de teclado, scroll, mover el ratón, captura de pantalla, esperar, activar ventana. Úsalo para CUALQUIER interacción directa con el sistema.",
        parameters: {
            type: "OBJECT",
            properties: {
                action: {
                    type: "STRING",
                    description: "type | click | double_click | right_click | move | hotkey | press | scroll | screenshot | wait | focus_window"
                },
                text:       { type: "STRING",  description: "Texto a escribir (acción type)" },
                x:          { type: "INTEGER", description: "Coordenada X en píxeles" },
                y:          { type: "INTEGER", description: "Coordenada Y en píxeles" },
                keys:       { type: "STRING",  description: "Atajo de teclado, ej. 'ctrl+c', 'ctrl+shift+t'" },
                key:        { type: "STRING",  description: "Tecla individual, ej. 'enter', 'escape', 'tab', 'f5'" },
                direction:  { type: "STRING",  description: "Dirección de scroll: up | down | left | right" },
                amount:     { type: "INTEGER", description: "Cantidad de scroll (por defecto: 3)" },
                seconds:    { type: "NUMBER",  description: "Segundos a esperar (acción wait)" },
                app:        { type: "STRING",  description: "Nombre de ventana a activar (acción focus_window)" },
            },
            required: ["action"]
        }
    },

    // ── Screen vision (Gemini multimodal) ────────────────────────────────────
    {
        name: "screen_vision",
        description: "Toma una captura de pantalla o foto de la webcam y la analiza visualmente con IA. Úsalo para describir lo que hay en pantalla, leer contenido, verificar acciones, o ver por la cámara qué hay frente al ordenador.",
        parameters: {
            type: "OBJECT",
            properties: {
                text:  { type: "STRING", description: "Pregunta o instrucción sobre lo que se ve" },
                angle: { type: "STRING", description: "screen (captura de pantalla, default) | camera (webcam)" }
            },
            required: ["text"]
        }
    },

    // ── YOLO Vision Detect ───────────────────────────────────────────────────
    {
        name: "vision_detect",
        description: "Detecta elementos de interfaz en pantalla usando el modelo YOLO orbit_master_v1.pt (entrenado con botones, campos de texto e iconos de Windows apps). Devuelve posiciones exactas en coordenadas de pantalla. Úsalo antes de hacer click en un elemento específico.",
        parameters: {
            type: "OBJECT",
            properties: {
                label: {
                    type: "STRING",
                    description: "Filtro de clase: 'botones' | 'campo_texto' | 'icono' (omitir = detectar todo)"
                },
                conf: {
                    type: "NUMBER",
                    description: "Confianza mínima 0.0–1.0 (por defecto 0.45)"
                }
            },
            required: []
        }
    },

    // ── YOLO Vision Click ────────────────────────────────────────────────────
    {
        name: "vision_click",
        description: "Detecta un elemento por su tipo (botón, campo de texto, icono) usando YOLO y hace click con movimiento natural (curva Bézier). Más preciso que computer_control click porque localiza el elemento visualmente.",
        parameters: {
            type: "OBJECT",
            properties: {
                label:    { type: "STRING",  description: "Tipo de elemento: 'botones' | 'campo_texto' | 'icono'" },
                instance: { type: "INTEGER", description: "Índice del elemento si hay varios (0 = primero más probable)" },
                conf:     { type: "NUMBER",  description: "Confianza mínima (por defecto 0.45)" }
            },
            required: ["label"]
        }
    },

    // ── YOLO Vision Type ─────────────────────────────────────────────────────
    {
        name: "vision_type",
        description: "Detecta un campo de texto usando YOLO, hace click en él y escribe el texto con ritmo humano (intervalos aleatorios entre teclas). Más preciso que computer_control type cuando necesitas encontrar el campo primero.",
        parameters: {
            type: "OBJECT",
            properties: {
                text:          { type: "STRING", description: "Texto a escribir" },
                element_label: { type: "STRING", description: "Tipo de campo: 'campo_texto' (por defecto) | 'botones'" },
                conf:          { type: "NUMBER", description: "Confianza mínima (por defecto 0.45)" }
            },
            required: ["text"]
        }
    },

    // ── Vision Status ────────────────────────────────────────────────────────
    {
        name: "vision_status",
        description: "Verifica si el motor de visión Python (YOLO) está activo y el modelo orbit_master_v1.pt está cargado correctamente.",
        parameters: {
            type: "OBJECT",
            properties: {},
            required: []
        }
    },

    // ── Browser control ──────────────────────────────────────────────────────
    {
        name: "browser_control",
        description: "Controla Chrome/Edge con Puppeteer: navegar a URLs, buscar en Google, hacer click, escribir en formularios, leer texto de páginas web, hacer scroll, cerrar el navegador.",
        parameters: {
            type: "OBJECT",
            properties: {
                action:   { type: "STRING", description: "go_to | search | click | type | scroll | get_text | close" },
                url:      { type: "STRING", description: "URL completa para go_to" },
                query:    { type: "STRING", description: "Búsqueda en Google para action=search" },
                selector: { type: "STRING", description: "CSS selector para click/type/get_text" },
                text:     { type: "STRING", description: "Texto para acción type" },
                direction:{ type: "STRING", description: "up | down para scroll" },
            },
            required: ["action"]
        }
    },

    // ── File system ──────────────────────────────────────────────────────────
    {
        name: "file_controller",
        description: "Gestión de archivos y carpetas: listar, leer, crear, escribir, mover, copiar, eliminar, buscar. Soporta atajos como 'desktop', 'downloads', 'documents'.",
        parameters: {
            type: "OBJECT",
            properties: {
                action:      { type: "STRING", description: "list | read | write | create_file | delete | move | copy | find" },
                path:        { type: "STRING", description: "Ruta del archivo o carpeta (ej. 'desktop', 'C:/Users/HP/Documents/nota.txt')" },
                content:     { type: "STRING", description: "Contenido a escribir (para write/create_file)" },
                name:        { type: "STRING", description: "Nombre del nuevo archivo (para create_file)" },
                destination: { type: "STRING", description: "Destino para move/copy" },
                extension:   { type: "STRING", description: "Extensión para buscar, ej. '.pdf'" }
            },
            required: ["action"]
        }
    },

    // ── CMD / Shell ──────────────────────────────────────────────────────────
    {
        name: "cmd_control",
        description: "Ejecuta comandos de sistema Windows (PowerShell/cmd). Úsalo para instalar programas, ejecutar scripts, consultar el sistema, gestionar procesos.",
        parameters: {
            type: "OBJECT",
            properties: {
                task:    { type: "STRING", description: "Descripción en lenguaje natural de lo que ejecutar" },
                command: { type: "STRING", description: "Comando exacto (tiene prioridad sobre task)" }
            },
            required: []
        }
    },

    // ── Agent task (multi-step autonomous) ───────────────────────────────────
    {
        name: "agent_task",
        description: "Ejecuta tareas complejas de múltiples pasos que requieren planificación: 'investiga X y guarda en un archivo', 'llena un formulario en una web', 'escribe y prueba un script'. El agente planifica y ejecuta los pasos automáticamente.",
        parameters: {
            type: "OBJECT",
            properties: {
                goal:     { type: "STRING", description: "Descripción completa de la tarea a realizar" },
                priority: { type: "STRING", description: "low | normal | high (por defecto: normal)" }
            },
            required: ["goal"]
        }
    },

    // ── Screen Find (Gemini Vision element locator) ──────────────────────────
    {
        name: "screen_find",
        description: "Busca CUALQUIER elemento visual en pantalla por descripción usando Gemini Vision. Devuelve las coordenadas (x, y) exactas del centro del elemento. Úsalo para encontrar botones, textos, iconos, perfiles, imágenes, o cualquier cosa visible en pantalla antes de hacer click.",
        parameters: {
            type: "OBJECT",
            properties: {
                description: { type: "STRING", description: "Descripción del elemento a buscar (ej. 'perfil OCHOA ROJAS', 'botón Aceptar', 'icono de WhatsApp en la barra de tareas', 'campo de búsqueda')" }
            },
            required: ["description"]
        }
    },

    // ── Click Element (find + click in one step) ─────────────────────────────
    {
        name: "click_element",
        description: "Busca un elemento en pantalla por descripción visual y hace click sobre él con movimiento natural del mouse (curva Bézier). Combina screen_find + click en un solo paso. ÚSALO SIEMPRE que necesites hacer click en algo que ves en pantalla (botones, perfiles, iconos, links, texto).",
        parameters: {
            type: "OBJECT",
            properties: {
                description: { type: "STRING", description: "Descripción visual del elemento a clickear (ej. 'perfil OCHOA ROJAS', 'botón Enviar', 'pestaña WhatsApp', 'X para cerrar')" },
                click_type:  { type: "STRING", description: "left (default) | right | double" }
            },
            required: ["description"]
        }
    },

    // ── Drag (mouse drag from A to B) ────────────────────────────────────────
    {
        name: "drag",
        description: "Arrastra el mouse desde un punto a otro manteniendo el botón presionado. Útil para mover ventanas, redimensionar, sliders, arrastrar archivos.",
        parameters: {
            type: "OBJECT",
            properties: {
                from_x: { type: "INTEGER", description: "X de inicio (0 = posición actual)" },
                from_y: { type: "INTEGER", description: "Y de inicio (0 = posición actual)" },
                to_x:   { type: "INTEGER", description: "X de destino" },
                to_y:   { type: "INTEGER", description: "Y de destino" }
            },
            required: ["to_x", "to_y"]
        }
    },

    // ── Screen Context (full visual analysis) ────────────────────────────────
    {
        name: "screen_context",
        description: "Captura la pantalla y describe TODO lo que ve: ventanas abiertas, botones, textos, iconos, barra de tareas. Úsalo para entender qué hay en pantalla antes de decidir qué acción tomar. Más detallado que screen_vision, enfocado en elementos interactuables.",
        parameters: {
            type: "OBJECT",
            properties: {
                focus: { type: "STRING", description: "Área o tema específico en el que enfocarte (ej. 'el selector de perfiles de Chrome', 'la barra de tareas')" }
            },
            required: []
        }
    },

    // ── Spawn subagent (Phase 4.1) ───────────────────────────────────────────
    {
        name: "spawn_subagent",
        description: "Crea y lanza un subagente autónomo especializado para ejecutar una sub-tarea de forma independiente. El subagente planifica y ejecuta sus propios pasos en paralelo con el agente principal. Úsalo para delegar tareas que no dependen del resultado de otras.",
        parameters: {
            type: "OBJECT",
            properties: {
                goal:            { type: "STRING",  description: "Objetivo completo que debe lograr el subagente" },
                context:         { type: "STRING",  description: "Contexto adicional (datos, rutas, restricciones)" },
                parentSessionId: { type: "STRING",  description: "ID de sesión padre para correlacionar eventos (opcional)" },
                toolProfile:     { type: "STRING",  description: "minimal | standard | coding | full (default: hereda del padre)" },
                maxSteps:        { type: "INTEGER", description: "Límite de pasos del subagente (default: 8)" },
                timeoutMs:       { type: "INTEGER", description: "Timeout en ms (default: 120000)" }
            },
            required: ["goal"]
        }
    },
];

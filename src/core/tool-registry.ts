/**
 * Tool declarations sent to Gemini Live API.
 * Every tool here must have a corresponding case in actions/index.ts.
 */
export const TOOL_DECLARATIONS = [

    // ── Open any app ────────────────────────────────────────────────────────
    {
        name: "open_app",
        description: "Abre cualquier aplicación en el ordenador Windows. Úsalo cuando el usuario pida abrir, lanzar o iniciar cualquier app, sitio web o programa. SIEMPRE llama a este tool — nunca digas solo que lo abriste.",
        parameters: {
            type: "OBJECT",
            properties: {
                app_name: { type: "STRING", description: "Nombre exacto de la aplicación (ej. 'WhatsApp', 'Chrome', 'Spotify', 'Notepad')" }
            },
            required: ["app_name"]
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
        description: "Toma una captura de pantalla y la analiza visualmente con IA. Úsalo para describir lo que hay en pantalla, encontrar texto, leer contenido, entender la UI actual, o verificar si una acción tuvo efecto.",
        parameters: {
            type: "OBJECT",
            properties: {
                text: { type: "STRING", description: "Pregunta o instrucción sobre lo que se ve en pantalla" }
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
];

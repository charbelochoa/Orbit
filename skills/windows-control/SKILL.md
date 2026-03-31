---
name: windows-control
description: 'Cuándo usar: controlar Windows, abrir apps, ajustar volumen/brillo, mover ventanas, ejecutar comandos del sistema, automatizar el escritorio.'
metadata:
  orbit:
    emoji: 🪟
    category: windows
    tools: [open_app, computer_settings, computer_control, cmd_control, drag]
---
# Windows Control

## Abrir aplicaciones
```
open_app { app_name: "chrome" | "spotify" | "vscode" | "discord" | ... }
```
Aliases conocidos: chrome, firefox, edge, vscode, notepad, explorer,
discord, spotify, whatsapp, telegram, steam, obs, vlc, word, excel

## Ajustes del sistema
```
computer_settings { action: "volume_up" | "volume_down" | "volume_mute" | "volume_set", value: 50 }
computer_settings { action: "brightness_up" | "brightness_down" | "brightness_set", value: 70 }
computer_settings { action: "close_app", app: "chrome" }
computer_settings { action: "minimize" | "maximize" | "snap_left" | "snap_right" }
computer_settings { action: "show_desktop" | "switch_window" | "full_screen" }
```

## Control de mouse/teclado
```
computer_control { action: "click", x: 100, y: 200, button: "left" | "right" | "double" }
computer_control { action: "type", text: "Hola mundo" }
computer_control { action: "key", key: "ctrl+c" | "alt+tab" | "win+d" }
computer_control { action: "scroll", direction: "up" | "down", amount: 3 }
computer_control { action: "screenshot" }
```

## Patrón: Automatizar tarea con apps
1. `open_app` — abrir la aplicación
2. `screen_vision` o `screen_context` — ver estado actual
3. `click_element` — hacer click en elemento visual
4. `computer_control type` — escribir texto
5. Repetir hasta completar

## Comandos de sistema
```
cmd_control { task: "descripción en lenguaje natural de lo que quiero hacer" }
```
Ejemplos:
- "lista los archivos del escritorio"
- "crea una carpeta llamada Proyectos en el escritorio"
- "instala el paquete numpy con pip"

## Reglas
- Para hacer click en algo que ves en pantalla, SIEMPRE usa `click_element` con descripción
- Never hardcodees coordenadas — usa `screen_find` + descripción visual
- Para acciones destructivas (borrar, formatear), pide confirmación primero

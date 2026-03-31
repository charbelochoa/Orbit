---
name: browser-automation
description: 'Cuándo usar: navegar webs, llenar formularios, hacer click en elementos, extraer datos de páginas, automatizar flujos web completos.'
metadata:
  orbit:
    emoji: 🌐
    category: browser
    tools: [browser_control, screen_vision, click_element, computer_control]
---
# Browser Automation

## Acciones de browser_control
```
browser_control { action: "go_to",   url: "https://..." }
browser_control { action: "search",  query: "texto a buscar" }   // foco en barra y escribe
browser_control { action: "click",   selector: "CSS selector o texto del botón" }
browser_control { action: "type",    selector: "input[name=email]", text: "valor" }
browser_control { action: "scroll",  direction: "down", amount: 500 }
browser_control { action: "wait",    ms: 2000 }
browser_control { action: "extract", selector: ".content" }      // extrae texto
browser_control { action: "screenshot" }
```

## Patrón: llenar un formulario
1. `browser_control go_to` — navegar a la URL
2. `screen_context` — analizar qué hay en la página
3. `click_element` — hacer click en cada campo (descripción visual)
4. `computer_control type` — escribir en el campo activo
5. `click_element "botón Enviar"` — enviar

## Patrón: extraer datos de una página
1. `browser_control go_to` — navegar
2. `browser_control extract` con selector CSS — obtener texto
3. Si la página requiere interacción, usa `click_element` + `browser_control extract`

## Patrón: login
1. `browser_control go_to` — página de login
2. `click_element "campo email o usuario"` — click en el campo
3. `computer_control type` — escribir credencial
4. `click_element "campo contraseña"` — click en password
5. `computer_control type` — escribir contraseña
6. `click_element "botón Iniciar sesión"` — submit

## Reglas
- Si no puedes usar selector CSS, usa `click_element` con descripción visual
- Espera entre acciones cuando la página puede estar cargando (`browser_control wait`)
- Para páginas con JavaScript pesado, dale 2-3 segundos antes de extraer
- NUNCA guardes contraseñas en archivos sin cifrar

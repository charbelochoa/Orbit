---
name: coding
description: 'Cuándo usar: escribir scripts, automatizar tareas, generar código, ejecutar y depurar programas en cualquier lenguaje.'
metadata:
  orbit:
    emoji: 💻
    category: coding
    tools: [code_helper, cmd_control, file_controller]
    requires:
      anyBins: [node, python, python3]
---
# Coding

## Patrón: escribir y ejecutar
1. `code_helper write` con descripción clara de lo que debe hacer el código
2. `code_helper run` para ejecutar (o usar `auto_run: true` directamente)
3. Si falla → `code_helper fix` con el error

## Patrón: script multi-archivo
1. `file_controller create` — crear estructura de directorios si necesario
2. `code_helper write` — generar cada archivo por separado
3. `cmd_control` — instalar dependencias (`pip install X`, `npm install X`)
4. `cmd_control` — ejecutar el script principal

## Reglas
- Para scripts Python simples, usa `code_helper` con `auto_run: true`
- Para proyectos TypeScript/Node, genera en `file_controller` y ejecuta con `cmd_control`
- SIEMPRE verifica que el código funciona antes de declarar éxito
- Si hay errores repetidos (3+), cambia de enfoque completamente

## Lenguajes y cuándo usarlos
- **Python**: automatización, datos, scraping, IA
- **PowerShell**: administración Windows, archivos del sistema
- **JavaScript/TS**: web, APIs, Node.js
- **Batch**: scripts Windows legacy, compatibilidad

## Fix loop
```
write → run → (error?) → fix → run → (error?) → fix → run → ABORT si sigue fallando
```

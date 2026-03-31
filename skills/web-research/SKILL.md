---
name: web-research
description: 'Cuándo usar: buscar información actual, comparar opciones, obtener datos de noticias, investigar temas, recopilar referencias online.'
metadata:
  orbit:
    emoji: 🔍
    category: research
    tools: [web_search, browser_control, file_controller]
---
# Web Research

## Patrón básico
1. `web_search` con query específica y concisa
2. `browser_control go_to` para leer artículos completos si necesitas más detalle
3. `file_controller write` para guardar el resumen en disco

## Patrón de investigación profunda
1. `web_search` — búsqueda amplia para panorama general
2. `web_search` — 1-2 búsquedas más específicas sobre subtemas
3. `browser_control go_to` — leer las 2-3 fuentes más relevantes
4. `file_controller write` — guardar resumen estructurado con fuentes

## Reglas
- SIEMPRE cita las fuentes (URL o nombre del sitio)
- NO inventes datos — si no encuentras algo, dilo claramente
- Prefiere fuentes recientes (< 2 años)
- Si los resultados de búsqueda son insuficientes, reformula la query

## Queries efectivas
- Usa términos en inglés para temas técnicos (mejores resultados)
- Añade el año actual para información reciente: "best AI frameworks 2026"
- Para comparaciones: "X vs Y 2026"
- Para tutoriales: "how to X site:reddit.com OR site:stackoverflow.com"

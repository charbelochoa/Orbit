# Crear un Skill para Orbit

Un **skill** es un archivo `SKILL.md` con metadatos YAML y guías de razonamiento para el agente. A diferencia de los plugins (código), los skills son **instrucciones de dominio** que le dicen al planner cómo abordar tareas específicas.

## Estructura del archivo SKILL.md

```markdown
---
name: mi-skill
description: Breve descripción del skill (1-2 líneas)
category: research|coding|automation|system|integration|other
triggers:
  - palabras
  - que activan
  - este skill
---

# Nombre del Skill

## Cuándo usar este skill
[Describe los casos de uso]

## Cómo proceder
[Pasos recomendados, herramientas a usar, patrones]

## Herramientas relevantes
- `tool_name` — para qué sirve en este contexto

## Ejemplo de plan
[Un ejemplo concreto de cómo planificar una tarea típica]
```

## Directorio de skills

Todos los skills viven en `skills/<nombre>/SKILL.md` desde la raíz del proyecto:

```
skills/
├── web-research/
│   └── SKILL.md
├── coding/
│   └── SKILL.md
└── mi-skill/
    └── SKILL.md
```

## Activación automática

El planner busca skills relevantes usando las `triggers` del frontmatter YAML. Cuando el `goal` de una tarea contiene palabras clave que coinciden, ese skill se inyecta en el prompt del planner.

## Skills incluidos

| Skill | Categoría | Triggers ejemplo |
|-------|-----------|-----------------|
| web-research | research | investiga, busca, analiza |
| coding | coding | programa, código, script |
| file-ops | system | archivo, carpeta, lee, escribe |
| windows-control | system | abre, cierra, minimiza |
| browser-automation | automation | navega, haz click, extrae |
| github | integration | git, commit, pull request |
| notion | integration | notion, página, base de datos |
| spotify | integration | spotify, música, reproduce |

## Ejemplo completo

```markdown
---
name: data-analysis
description: Analiza datos tabulares (CSV, Excel, JSON) y genera insights
category: coding
triggers:
  - analiza datos
  - csv
  - excel
  - dataframe
  - estadísticas
  - dataset
---

# Data Analysis Skill

## Cuándo usar
Cuando el usuario quiere analizar datos estructurados, generar estadísticas o visualizaciones.

## Herramientas a usar
- `file` — leer el archivo de datos
- `cmd` — ejecutar scripts Python con pandas/numpy
- `web_search` — buscar contexto sobre los datos si es necesario

## Pasos recomendados
1. Leer el archivo con `file`
2. Inspeccionar estructura (primeras filas, tipos de columnas)
3. Calcular estadísticas básicas
4. Identificar patrones o anomalías
5. Generar un resumen claro para el usuario
```

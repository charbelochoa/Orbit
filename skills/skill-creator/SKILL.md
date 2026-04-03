---
name: skill-creator
description: 'Cuándo usar: cuando el usuario quiere crear una nueva skill para Orbit, documentar un flujo de trabajo repetitivo, o empaquetar conocimiento específico como skill reutilizable.'
metadata:
  orbit:
    emoji: 🧬
    category: meta
    tools: [file_controller, code_helper]
---
# Skill Creator

Guía para crear nuevas skills de Orbit. Una skill es un archivo SKILL.md que enseña a Orbit cómo hacer algo específico.

## ¿Qué es una Skill?

Una skill = SKILL.md con:
1. **Frontmatter YAML** — metadata, categoría, tools que usa, requisitos
2. **Body Markdown** — instrucciones, patrones, reglas, ejemplos
3. (Opcional) **Scripts** auxiliares en la misma carpeta

## Principio clave

> Orbit ya es inteligente. Solo añade lo que NO sabe: flujos específicos de tu empresa, APIs internas, convenciones de tu equipo, atajos que descubriste.

**No** necesitas enseñarle a programar en Python — ya sabe. **Sí** necesitas enseñarle el workflow exacto para deploy en tu infra.

## Proceso de creación

### Paso 1: Entender el objetivo
Pregúntate:
- ¿Qué tarea repito? (ej: "deploy a staging")
- ¿Qué tools de Orbit necesita? (cmd_control, browser_control, file_controller…)
- ¿Hay requisitos? (binarios, API keys, plataforma)
- ¿Es elegible en todas las máquinas o solo en algunas?

### Paso 2: Elegir nombre y categoría
```
Categorías: coding | system | web | comms | productivity | meta
```
El nombre debe ser kebab-case: `deploy-staging`, `notion-sync`, `email-digest`

### Paso 3: Crear la estructura
```
skills/
  mi-skill/
    SKILL.md          # (requerido) Instrucciones principales
    scripts/           # (opcional) Scripts auxiliares
    references/        # (opcional) Docs de referencia
```

### Paso 4: Escribir el frontmatter

```yaml
---
name: mi-skill
description: 'Cuándo usar: <describe cuándo Orbit debe activar esta skill>. <qué hace>.'
metadata:
  orbit:
    emoji: 🎯
    category: productivity
    tools: [cmd_control, file_controller]
    requires:
      bins: [docker]          # Todos requeridos
      # anyBins: [npm, yarn]  # Al menos uno
      # env: [DEPLOY_TOKEN]   # Variables de entorno
      # platform: [win32]     # win32 | darwin | linux
    install:
      - label: Windows
        command: 'winget install Docker.DockerDesktop'
      - label: macOS
        command: 'brew install --cask docker'
    # primaryEnv: DEPLOY_TOKEN  # Para guía de configuración
---
```

**Reglas del description:**
- SIEMPRE empieza con "Cuándo usar:"
- El description es el **mecanismo de matching** — Orbit lo usa para decidir si activar la skill
- Sé específico: "gestionar issues en GitHub" > "GitHub"
- Incluye sinónimos si el usuario puede pedirlo de formas distintas

### Paso 5: Escribir el body

Estructura recomendada:
```markdown
# Nombre de la Skill

## Prerequisitos
(solo si hay configuración necesaria más allá de `requires`)

## Operaciones comunes
### Operación 1
(instrucciones paso a paso con tools)

### Operación 2
...

## Patrones
(flujos de trabajo reutilizables)

## Reglas
- Regla 1 (SIEMPRE hacer X)
- Regla 2 (NUNCA hacer Y)
- Regla 3 (SI condición → ENTONCES acción)

## Errores comunes
(y cómo resolverlos)
```

**Niveles de especificidad:**
| Nivel | Cuándo usar | Ejemplo |
|-------|------------|---------|
| **Alta libertad** (texto) | Orbit ya sabe hacerlo bien | "Escribe tests unitarios para el módulo" |
| **Media** (pseudocódigo) | Necesita guía pero flexible | "1. Lint → 2. Test → 3. Build → 4. Deploy" |
| **Baja** (scripts exactos) | Debe ser preciso o es frágil | `docker compose -f prod.yml up -d --build` |

### Paso 6: Verificar

Checklist:
- [ ] El `name` coincide con el nombre de la carpeta
- [ ] El `description` empieza con "Cuándo usar:"
- [ ] Los `tools` listados existen en Orbit
- [ ] Los `requires` son correctos (probar con `where <bin>`)
- [ ] Las instrucciones son claras y paso a paso
- [ ] Hay reglas explícitas para casos edge
- [ ] No se repite conocimiento que Orbit ya tiene

## Ejemplo completo

```yaml
---
name: docker-deploy
description: 'Cuándo usar: deploy de contenedores Docker, construir imágenes, gestionar docker-compose, subir a registry.'
metadata:
  orbit:
    emoji: 🐳
    category: coding
    tools: [cmd_control, file_controller]
    requires:
      bins: [docker]
      anyBins: [docker-compose, docker]
    install:
      - label: Windows
        command: 'winget install Docker.DockerDesktop'
---
# Docker Deploy

## Operaciones comunes

### Build + Push
1. `cmd_control` — `docker build -t <imagen>:<tag> .`
2. `cmd_control` — `docker push <imagen>:<tag>`

### Deploy con compose
1. `file_controller read` — leer docker-compose.yml actual
2. `cmd_control` — `docker compose up -d --build`
3. `cmd_control` — `docker compose ps` (verificar estado)

## Reglas
- SIEMPRE verificar que Docker está corriendo antes de operar
- USAR tags semánticos: `v1.2.3`, no `latest` para producción
- LIMPIAR imágenes huérfanas: `docker image prune -f` después de builds
```

## Anti-patrones

❌ **No hagas esto:**
- Skills que solo repiten documentación oficial
- Skills sin `description` claro (no se activarán nunca)
- Instrucciones genéricas ("escribe buen código")
- Tools que no existen en `requires.tools`

✅ **Sí haz esto:**
- Flujos específicos de tu equipo/empresa
- Workarounds para errores conocidos
- Convenciones y estándares del proyecto
- Integraciones entre tools (ej: "leer de Notion → generar código → push a GitHub")

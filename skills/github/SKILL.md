---
name: github
description: 'Cuándo usar: crear PRs, gestionar issues, clonar repos, hacer commits, revisar código en GitHub. Requiere GitHub CLI (gh) instalado.'
metadata:
  orbit:
    emoji: 🐙
    category: coding
    tools: [cmd_control, file_controller, code_helper]
    requires:
      bins: [gh, git]
    install:
      - label: Windows
        command: 'winget install GitHub.cli'
      - label: macOS
        command: 'brew install gh'
---
# GitHub

## Prerequisito
GitHub CLI debe estar instalado y autenticado:
```
gh auth status      # verificar autenticación
gh auth login       # si no está autenticado
```

## Operaciones comunes

### Clonar un repositorio
```
cmd_control { task: "clona el repositorio https://github.com/user/repo en C:/proyectos/repo" }
```

### Crear una PR
```
# 1. Asegúrate de estar en la rama correcta
cmd_control { task: "crea una PR en el repositorio actual con título 'Fix: descripción' y descripción detallada" }
# O directamente:
cmd_control { task: "gh pr create --title 'titulo' --body 'descripcion'" }
```

### Gestionar Issues
```
cmd_control { task: "lista los issues abiertos del repositorio actual" }
cmd_control { task: "crea un issue con título 'Bug: X' y descripcion 'Y'" }
cmd_control { task: "cierra el issue #123 con comentario 'Resuelto en PR #456'" }
```

### Commits y ramas
```
cmd_control { task: "crea una rama feature/nueva-funcionalidad, haz commit de todos los cambios con mensaje 'feat: descripcion' y sube al remote" }
```

### Ver estado del repo
```
cmd_control { task: "muestra el estado de git, los cambios pendientes y la rama actual" }
```

## Reglas
- SIEMPRE trabaja desde la rama correcta antes de hacer commits
- Usa mensajes de commit descriptivos: `feat:`, `fix:`, `docs:`, `refactor:`
- Para PRs, incluye siempre descripción de los cambios
- Verifica con `gh pr status` antes de hacer merge

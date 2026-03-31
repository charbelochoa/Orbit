---
name: file-ops
description: 'Cuándo usar: crear, leer, editar, mover, copiar o eliminar archivos y carpetas. Gestión de contenido en disco.'
metadata:
  orbit:
    emoji: 📁
    category: files
    tools: [file_controller, cmd_control]
---
# File Operations

## Acciones disponibles en file_controller
- `read`        — leer contenido de un archivo
- `write`       — crear/sobrescribir archivo con contenido
- `append`      — añadir al final de un archivo
- `list`        — listar contenido de un directorio
- `create_dir`  — crear directorio
- `delete`      — eliminar archivo o directorio
- `move`        — mover/renombrar archivo
- `copy`        — copiar archivo

## Patrones comunes

### Crear un archivo con contenido
```
file_controller { action: "write", path: "C:/ruta/archivo.txt", content: "..." }
```

### Leer y modificar
```
1. file_controller read → obtener contenido
2. procesar el contenido
3. file_controller write → guardar resultado
```

### Organizar archivos
```
1. file_controller list → ver qué hay
2. file_controller create_dir → crear estructura
3. file_controller move × N → mover archivos
```

## Rutas en Windows
- Usa barras normales `/` o dobles `\\`
- Rutas relativas: desde `C:/Users/HP/Desktop/EMPRESA/Orbit/`
- Variables útiles: `%USERPROFILE%`, `%TEMP%`, `%APPDATA%`

## Reglas
- NUNCA elimines sin confirmar primero qué hay en la ruta
- Para archivos grandes, usa append para no perder contenido
- Los paths sensibles del sistema (System32, etc.) requieren permisos de admin

---
name: notion
description: 'Cuándo usar: crear páginas, añadir contenido a bases de datos, buscar en Notion. Requiere Notion API token configurado.'
metadata:
  orbit:
    emoji: 📓
    category: comms
    tools: [cmd_control, code_helper, web_search]
---
# Notion

## Prerequisito
Token de integración Notion en `.env`:
```
NOTION_TOKEN=secret_xxxxxxxx
```

## Patrón: crear una página en un workspace

### Via API con Python
```python
import os, requests

headers = {
    "Authorization": f"Bearer {os.environ['NOTION_TOKEN']}",
    "Content-Type": "application/json",
    "Notion-Version": "2022-06-28"
}

# Crear página en una base de datos
data = {
    "parent": { "database_id": "DATABASE_ID" },
    "properties": {
        "Name": { "title": [{ "text": { "content": "Título de la página" }}]},
    },
    "children": [
        {
            "object": "block",
            "type": "paragraph",
            "paragraph": { "rich_text": [{ "text": { "content": "Contenido aquí" }}]}
        }
    ]
}
res = requests.post("https://api.notion.com/v1/pages", json=data, headers=headers)
print(res.json())
```

## Patrón: buscar en Notion
```python
data = { "query": "término de búsqueda" }
res = requests.post("https://api.notion.com/v1/search", json=data, headers=headers)
```

## Patrón con code_helper
```
code_helper write {
  task: "Script Python que añade una entrada a la base de datos Notion DATABASE_ID con título X y contenido Y",
  language: "python",
  auto_run: true
}
```

## Reglas
- Necesitas el DATABASE_ID de la base de datos destino (visible en la URL de Notion)
- Las páginas deben pertenecer a una integración que tengas acceso
- Para añadir bloques a páginas existentes, usa el endpoint PATCH /v1/blocks/{id}/children

# Crear un Plugin para Orbit

Un **plugin** es un módulo que registra una o más herramientas (`OrbitTool`) disponibles para el agente.

## Estructura mínima

```typescript
// src/plugins/my-plugin.ts
import type { OrbitPlugin } from "./types.js";

const myPlugin: OrbitPlugin = {
    id: "my-plugin",
    name: "Mi Plugin",
    version: "1.0.0",
    tools: [
        {
            name: "my_tool",
            description: "Descripción de lo que hace la herramienta",
            parameters: {
                type: "object",
                properties: {
                    input: { type: "string", description: "El input para procesar" },
                },
                required: ["input"],
            },
            handler: async (params) => {
                // Lógica aquí
                return `Procesado: ${params.input}`;
            },
        },
    ],
};

export default myPlugin;
```

## Registro automático

Coloca el plugin en `src/plugins/` y será cargado automáticamente por `loadAllPlugins()` al arrancar Orbit.

## Tipos disponibles

```typescript
import type { OrbitPlugin, OrbitTool } from "./types.js";

interface OrbitTool {
    name: string;         // Identificador único (snake_case)
    description: string;  // Para el LLM (cómo usar esta tool)
    parameters: {         // JSON Schema de los parámetros
        type: "object";
        properties: Record<string, { type: string; description: string }>;
        required?: string[];
    };
    handler: (params: any) => Promise<string>;  // Implementación
}
```

## Ejemplo completo: plugin de meteorología

```typescript
// src/plugins/weather-plugin.ts
import type { OrbitPlugin } from "./types.js";

const weatherPlugin: OrbitPlugin = {
    id: "weather",
    name: "Weather Plugin",
    version: "1.0.0",
    tools: [
        {
            name: "get_weather",
            description: "Obtiene el clima actual de una ciudad",
            parameters: {
                type: "object",
                properties: {
                    city: { type: "string", description: "Nombre de la ciudad" },
                    units: { type: "string", description: "celsius o fahrenheit" },
                },
                required: ["city"],
            },
            handler: async (params) => {
                const res = await fetch(
                    `https://wttr.in/${encodeURIComponent(params.city)}?format=3`
                );
                return await res.text();
            },
        },
    ],
};

export default weatherPlugin;
```

## Buenas prácticas

- El `handler` debe siempre retornar un `string` (puede ser JSON serializado).
- Usa `try/catch` en el handler y retorna un mensaje de error descriptivo.
- El campo `description` lo lee el LLM — sé específico sobre cuándo usar la herramienta.
- No hagas operaciones destructivas sin confirmar con el usuario.

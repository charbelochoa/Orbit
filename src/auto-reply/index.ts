/**
 * Orbit Auto-Reply — Public Entry Point (Phase 6)
 *
 * Call `initAutoReply()` once at startup to register all built-in commands.
 * Then use `isCommand()` + `dispatchCommand()` in the gateway message handler.
 */

export { dispatchCommand } from "./dispatcher.js";
export { isCommand }       from "./command-detection.js";

import { commandRegistry } from "./dispatcher.js";
import { taskCommand }     from "./commands/task.js";
import { memoryCommand }   from "./commands/memory.js";
import { skillsCommand }   from "./commands/skills.js";
import { statusCommand }   from "./commands/status.js";
import { cancelCommand }   from "./commands/cancel.js";
import { modelCommand }    from "./commands/model.js";
import { daemonCommand }   from "./commands/daemon.js";
import { initCommand }     from "./commands/init.js";
import { costCommand }     from "./commands/cost.js";
import { compactCommand }  from "./commands/compact.js";
import { diffCommand }     from "./commands/diff.js";
import { doctorCommand }   from "./commands/doctor.js";
import { reviewCommand }   from "./commands/review.js";
import { rewindCommand }   from "./commands/rewind.js";
import { todosCommand }    from "./commands/todos.js";
import { mcpCommand }      from "./commands/mcp.js";
import { insightsCommand } from "./commands/insights.js";
import { resetTokenUsage } from "../gateway/server.js";
import type { CommandContext } from "./types.js";

export function initAutoReply(): void {
    commandRegistry.register({
        name:        "init",
        description: "Analiza el proyecto y genera ORBIT.md con contexto",
        usage:       "/init [force]  — fuerza regeneración si ya existe",
        handler:     initCommand,
    });

    commandRegistry.register({
        name:        "task",
        description: "Ejecuta una tarea multi-paso con el agente",
        usage:       "/task <objetivo>",
        handler:     taskCommand,
    });

    commandRegistry.register({
        name:        "memory",
        aliases:     ["mem"],
        description: "Consulta o busca en la memoria de Orbit",
        usage:       "/memory show | /memory search <query>",
        handler:     memoryCommand,
    });

    commandRegistry.register({
        name:        "skills",
        aliases:     ["skill"],
        description: "Lista skills disponibles o muestra uno",
        usage:       "/skills list | /skills help <nombre>",
        handler:     skillsCommand,
    });

    commandRegistry.register({
        name:        "status",
        aliases:     ["s"],
        description: "Muestra estado del sistema y tareas activas",
        usage:       "/status",
        handler:     statusCommand,
    });

    commandRegistry.register({
        name:        "cancel",
        description: "Cancela una tarea en ejecución",
        usage:       "/cancel <taskId>",
        handler:     cancelCommand,
    });

    commandRegistry.register({
        name:        "model",
        aliases:     ["provider"],
        description: "Muestra o cambia el provider LLM activo en tiempo real",
        usage:       "/model [<id>]  — ids: gemini | openai | anthropic | ollama",
        handler:     modelCommand,
    });

    commandRegistry.register({
        name:        "daemon",
        aliases:     ["autostart"],
        description: "Controla el autostart de Orbit (Windows Task Scheduler)",
        usage:       "/daemon status | install | uninstall | logs [N]",
        handler:     daemonCommand,
    });

    commandRegistry.register({
        name:        "cost",
        aliases:     ["usage"],
        description: "Muestra uso de tokens y costo estimado de la sesión",
        usage:       "/cost",
        handler:     costCommand,
    });

    commandRegistry.register({
        name:        "compact",
        description: "Resumir conversación y liberar contexto",
        usage:       "/compact [instrucciones]",
        handler:     compactCommand,
    });

    commandRegistry.register({
        name:        "diff",
        description: "Muestra el git diff del proyecto",
        usage:       "/diff [--staged] [archivo]",
        handler:     diffCommand,
    });

    commandRegistry.register({
        name:        "doctor",
        aliases:     ["health"],
        description: "Diagnóstico del sistema Orbit",
        usage:       "/doctor",
        handler:     doctorCommand,
    });

    commandRegistry.register({
        name:        "review",
        description: "Code review del diff actual con IA",
        usage:       "/review",
        handler:     reviewCommand,
    });

    commandRegistry.register({
        name:        "rewind",
        aliases:     ["undo"],
        description: "Deshace los últimos N turnos del chat",
        usage:       "/rewind [N]",
        handler:     rewindCommand,
    });

    commandRegistry.register({
        name:        "todos",
        aliases:     ["todo"],
        description: "Gestión de tareas inline",
        usage:       "/todos [add|done|wip|rm|clear] [id|texto]",
        handler:     todosCommand,
    });

    commandRegistry.register({
        name:        "mcp",
        description: "Gestiona servidores MCP (Model Context Protocol)",
        usage:       "/mcp list|enable|disable|logs|tools|reload [nombre]",
        handler:     mcpCommand,
    });

    commandRegistry.register({
        name:        "insights",
        aliases:     ["analytics", "stats"],
        description: "Análisis de tus sesiones: tareas, herramientas, archivos",
        usage:       "/insights",
        handler:     insightsCommand,
    });

    // Built-in /help command (no separate handler file needed)
    commandRegistry.register({
        name:        "help",
        aliases:     ["h", "?"],
        description: "Lista todos los comandos disponibles",
        usage:       "/help",
        handler:     async (ctx: CommandContext) => {
            const cmds = commandRegistry.getAll();
            const lines = cmds.map(c => `**/${c.name}** — ${c.description}\n  ${c.usage}`);
            return `**Comandos de Orbit (${cmds.length}):**\n${lines.join("\n")}`;
        },
    });

    // Built-in /clear command
    commandRegistry.register({
        name:        "clear",
        description: "Limpia el historial visible del chat",
        usage:       "/clear",
        handler:     async (ctx: CommandContext) => {
            resetTokenUsage();
            ctx.sendReply({ type: "chat_cleared" });
            return "Historial de chat limpiado.";
        },
    });
}

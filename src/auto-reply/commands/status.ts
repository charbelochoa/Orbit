/**
 * /status
 * Shows current task queue, tools count, and skills count.
 */

import { getQueue }            from "../../agent/task-queue.js";
import { listDelegatedJobs }   from "../../agent/delegated-jobs.js";
import { getBackgroundProcesses } from "../../actions/cmd-control.js";
import { toolRegistry }        from "../../core/registry.js";
import { skillRegistry }       from "../../skills/registry.js";
import { providerRegistry }    from "../../providers/registry.js";
import type { CommandHandler } from "../types.js";

export const statusCommand: CommandHandler = async (ctx) => {
    const tasks   = getQueue().listAll();
    const pending = tasks.filter(t => t.status === "pending").length;
    const running = tasks.filter(t => t.status === "running").length;
    const done    = tasks.filter(t => t.status === "done").length;
    const failed  = tasks.filter(t => t.status === "failed").length;
    const interrupted = tasks.filter(t => t.status === "interrupted");
    const delegated = listDelegatedJobs().filter(job => job.status === "running" || job.status === "pending");

    // Send structured data so the UI can render it properly
    ctx.sendReply({
        type: "status",
        tasks: [...delegated, ...tasks.map(t => ({
            id:       t.id,
            goal:     t.goal.slice(0, 60),
            status:   t.status,
            priority: t.priority,
            provider: t.provider,
            model:    t.model,
        }))],
    });

    const provInfo   = providerRegistry.getActiveInfo();
    const available  = providerRegistry.listAvailable();

    return [
        "**Estado de Orbit**",
        `🤖 Provider activo:   ${provInfo.name} (${provInfo.id})`,
        `   Disponibles:      ${available.join(", ") || "ninguno"}`,
        `🔧 Tools registradas: ${toolRegistry.count}`,
        `📚 Skills cargados:   ${skillRegistry.count}`,
        `📋 Tareas: ${pending} pendientes | ${running} activas | ${done} completadas | ${failed} fallidas`,
        ...interrupted.map(task => `Interrumpida ${task.id} · ${task.goal}${task.model ? ` · ${task.model}` : ""}`),
        ...delegated.map(job => `${job.kind === "swarm" ? "Grupo" : "Subagente"} ${job.id} · ${job.goal}`),
        ...getBackgroundProcesses().map(process => `Proceso ${process.id} · PID ${process.pid} · ${process.stopping ? "deteniendo" : "en ejecución"}`),
    ].join("\n");
};

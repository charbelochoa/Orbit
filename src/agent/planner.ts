import { z } from "zod";
import { generateText } from "../providers/registry.js";
import { getConfig } from "../config/config.js";
import { toolRegistry, type ToolProfile } from "../core/registry.js";
import { policyEngine } from "../core/tool-policy.js";
import { skillRegistry } from "../skills/registry.js";
import { IterationBudget } from "./iteration-budget.js";
import { buildProjectContext } from "../context/project-facts.js";

const stepSchema = z.object({
    step: z.number().int().positive(),
    tool: z.string().min(1),
    description: z.string().trim().min(1),
    parameters: z.record(z.string(), z.unknown()),
    dependsOn: z.array(z.number().int().positive()).default([]),
});

const delegatedTools = new Set(["agent_task", "task_create", "spawn_subagent", "run_swarm"]);
export type PlanStep = z.infer<typeof stepSchema>;

export interface PlanOptions {
    context?: string;
    signal?: AbortSignal;
    toolProfile?: ToolProfile;
    maxSteps?: number;
}

export async function createPlan(goal: string, options: PlanOptions = {}): Promise<{ goal: string; steps: PlanStep[] }> {
    const { context = "", signal, toolProfile, maxSteps } = options;
    const config = getConfig();
    if (maxSteps !== undefined && (!Number.isInteger(maxSteps) || maxSteps < 1)) {
        throw new Error("El límite de pasos debe ser un entero positivo.");
    }
    const stepLimit = Math.min(config.agent.maxPlanSteps, maxSteps ?? config.agent.maxPlanSteps);
    const catalog = policyEngine.filterTools(toolRegistry.getByProfile(config.toolProfile))
        .filter(tool => !delegatedTools.has(tool.id) && (!toolProfile || tool.profiles.includes(toolProfile)))
        .map(({ id, description, parameters }) => ({ name: id, description, parameters }));
    if (!catalog.length) throw new Error("El perfil activo no tiene herramientas para esta tarea.");
    const toolNames = new Set(catalog.map(tool => tool.name));
    const schema = z.object({ steps: z.array(stepSchema).min(1).max(stepLimit) });
    const skills = skillRegistry.findRelevant(goal, 3).map(skill => ({
        name: skill.metadata.name,
        guidance: skill.content.slice(0, 800),
    }));
    const systemPrompt = [
        "You plan work for Orbit. Return JSON with a steps array.",
        'Each step has {"step":1,"tool":"name","description":"purpose","parameters":{},"dependsOn":[]}.',
        "Use only tools and arguments from the catalog. Give each step a unique positive integer ID.",
        "List all prerequisite step IDs in dependsOn. Independent steps may run concurrently.",
        'To reuse an earlier tool result, use "{{step_1}}" in a string parameter and depend on step 1.',
        `Use at most ${stepLimit} steps. Use the smallest plan that verifies the goal.`,
        JSON.stringify(catalog),
    ].join("\n");
    const budget = new IterationBudget(config.agent.maxReplans + 1);
    const project = await buildProjectContext();
    let issue = "";

    while (budget.consume()) {
        signal?.throwIfAborted();
        const response = await generateText({
            systemPrompt,
            messages: [{ role: "user", content: JSON.stringify({ goal, context, skills, project, previousPlanError: issue }) }],
            responseFormat: "json",
            maxTokens: 4096,
            signal,
        });
        try {
            const text = response.text.trim().replace(/^```(?:json)?\s*|\s*```$/gi, "");
            const { steps } = schema.parse(JSON.parse(text));
            validatePlan(steps, toolNames);
            return { goal, steps };
        } catch (error) {
            issue = (error instanceof Error ? error.message : String(error)).slice(0, 1200);
        }
    }
    throw new Error("Orbit no pudo elaborar un plan ejecutable para la tarea.");
}

function validatePlan(steps: PlanStep[], tools: Set<string>) {
    const ids = new Set(steps.map(step => step.step));
    if (ids.size !== steps.length) throw new Error("Step IDs must be unique.");
    for (const step of steps) {
        if (!tools.has(step.tool)) throw new Error(`Unknown tool: ${step.tool}.`);
        if (step.dependsOn.some(id => !ids.has(id))) throw new Error(`Step ${step.step} has an unknown dependency.`);
    }
    const completed = new Set<number>();
    while (completed.size < steps.length) {
        const ready = steps.filter(step => !completed.has(step.step) && step.dependsOn.every(id => completed.has(id)));
        if (!ready.length) throw new Error("Step dependencies contain a cycle.");
        for (const step of ready) completed.add(step.step);
    }
}

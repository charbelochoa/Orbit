import { generateText }  from "../providers/registry.js";
import { createLogger }  from "../infra/logger.js";
import { skillRegistry } from "../skills/registry.js";

const log = createLogger("planner");

/** Sanitize strings for log output — prevent log injection via newlines/CR */
const sanitizeForLog = (s: string) => s.replace(/[\r\n]+/g, " ").slice(0, 300);

const PLANNER_PROMPT = `
You are the planning module of ORBIT.
Your job: break any user goal into a sequence of steps using ONLY the tools available.

ABSOLUTE RULES:
- Use web_search for ANY info retrieval.
- Use file_controller to save content to disk.
- Use cmd_control to open files or run system commands.
- Max 8 steps. Use the MINIMUM number of steps needed.
- For steps that can run at the same time (e.g. two independent web searches), set "dependsOn": [] for both.
- For steps that need a prior step's output, set "dependsOn": [<step_number>].

OUTPUT — return ONLY valid JSON, no markdown, no explanation:
{
  "goal": "...",
  "steps": [
    { "step": 1, "tool": "tool_name", "description": "what this step does", "parameters": {}, "dependsOn": [] },
    { "step": 2, "tool": "tool_name", "description": "what this step does", "parameters": {}, "dependsOn": [1] }
  ]
}`;

export async function createPlan(goal: string, context: string = ""): Promise<any> {
    log.info(`Planificando meta: ${sanitizeForLog(goal)}`);
    try {
        let userPrompt = `Goal: ${goal}`;
        if (context) userPrompt += `\nContext: ${context}`;

        // Inject relevant skills (Phase 5)
        const relevantSkills = skillRegistry.findRelevant(goal, 3);
        if (relevantSkills.length > 0) {
            const skillsBlock = relevantSkills
                .map(s => `--- SKILL: ${s.metadata.name} ---\n${s.content.slice(0, 600)}`)
                .join("\n\n");
            userPrompt += `\n\nRELEVANT SKILLS (follow these patterns when applicable):\n${skillsBlock}`;
        }

        const response = await generateText({
            systemPrompt: PLANNER_PROMPT,
            messages: [{ role: "user", content: userPrompt }],
            responseFormat: "json",
        });

        let text = response.text || "{}";
        text = text.replace(/```(json)?/gi, "").trim();
        const plan = JSON.parse(text);
        if (!plan.steps) throw new Error("El plan generado no tiene pasos.");
        log.info(`Plan de ${plan.steps.length} pasos generado (via ${response.provider}).`);
        return plan;
    } catch (e: any) {
        log.error(`Plan fallido: ${e.message}. Generando fallback...`);
        return { goal, steps: [{ step: 1, tool: "cmd_control", description: "fallback", parameters: { task: goal } }] };
    }
} /** * Re-plan remaining steps when the current approach fails. * Uses the error context to generate a different strategy. */
export async function replan(goal: string, failedSteps: string, errorMsg: string): Promise<any> {
    log.info(`Replanificando: ${sanitizeForLog(goal)}`);
    try {
        const replanPrompt = `Goal: ${goal}\nThe previous steps FAILED: ${failedSteps}\nError encountered: ${errorMsg}\n\nGenerate a NEW plan using a DIFFERENT approach. Avoid the same tools/strategy that failed.`;

        const response = await generateText({
            systemPrompt: PLANNER_PROMPT,
            messages: [{ role: "user", content: replanPrompt }],
            responseFormat: "json",
        });

        let text = response.text || "{}";
        text = text.replace(/```(json)?/gi, "").trim();
        const plan = JSON.parse(text);
        if (!plan.steps) throw new Error("Replan sin pasos.");
        log.info(`Replan de ${plan.steps.length} pasos generado (via ${response.provider}).`);
        return plan;
    } catch (e: any) {
        log.error(`Replan fallido: ${e.message}`);
        return { goal, steps: [] };
    }
}

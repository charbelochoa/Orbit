import { GoogleGenAI } from "@google/genai";
import dotenv from "dotenv";

dotenv.config();

const PLANNER_PROMPT = `
You are the planning module of ORBIT.
Your job: break any user goal into a sequence of steps using ONLY the tools available.

ABSOLUTE RULES:
- Use web_search for ANY info retrieval.
- Use file_controller to save content to disk.
- Use cmd_control to open files or run system commands.
- Max 5 steps. Minimum steps needed.

OUTPUT — return ONLY valid JSON:
{
  "goal": "...",
  "steps": [
    {
      "step": 1,
      "tool": "tool_name",
      "description": "what this step does",
      "parameters": {}
    }
  ]
}`;

export async function createPlan(goal: string, context: string = ""): Promise<any> {
    console.log(`[Planner] 🤔 Planificando meta: ${goal}`);
    try {
        const apiKey = process.env.GEMINI_API_KEY;
        if (!apiKey) throw new Error("GEMINI_API_KEY no encontrada");
        const ai = new GoogleGenAI({ apiKey });

        let userPrompt = `Goal: ${goal}`;
        if (context) userPrompt += `\nContext: ${context}`;

        const response = await ai.models.generateContent({
            model: "gemini-2.5-flash-lite",
            contents: [
                { role: "user", parts: [{ text: userPrompt }] }
            ],
            config: {
                 systemInstruction: { parts: [{ text: PLANNER_PROMPT }] },
            }
        });

        let text = response.text || "{}";
        text = text.replace(/```(json)?/gi, "").trim();

        const plan = JSON.parse(text);
        if (!plan.steps) throw new Error("El plan generado no tiene pasos.");

        console.log(`[Planner] ✅ Plan de ${plan.steps.length} pasos generado.`);
        return plan;
    } catch (e: any) {
        console.error(`[Planner] ⚠️ Plan fallido: ${e.message}. Generando fallback...`);
        return {
            goal,
            steps: [{ step: 1, tool: "cmd_control", description: "fallback", parameters: { task: goal } }]
        };
    }
}

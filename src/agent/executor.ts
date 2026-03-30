import { createPlan } from "./planner.js";
import { executeTool } from "../actions/index.js";

interface StepResult {
    stepId: number;
    success: boolean;
    output: string;
}

export class AgentExecutor {
    private isCancelled: boolean = false;

    public cancel() {
        this.isCancelled = true;
    }

    public async executeGoal(goal: string, speakFallback?: (msg: string) => void): Promise<string> {
        console.log(`\n[Agent Executor] 🎯 Iniciando meta global: ${goal}`);
        
        const plan = await createPlan(goal);
        const results: StepResult[] = [];
        const steps = plan.steps || [];

        if (steps.length === 0) {
            const msg = "No pude elaborar un plan seguro para esta tarea.";
            if (speakFallback) speakFallback(msg);
            return msg;
        }

        for (const step of steps) {
            if (this.isCancelled) {
                if (speakFallback) speakFallback("Tarea cancelada.");
                return "Ejecución cancelada por el usuario.";
            }

            console.log(`\n[Agent Executor] ▶️ Step ${step.step}: [${step.tool}] ${step.description}`);
            
            try {
                // Ejecuta la herramienta física
                const result = await executeTool(step.tool, step.parameters);
                console.log(`[Agent Executor] ✅ Paso ${step.step} completado: ${result.substring(0, 100)}...`);
                
                results.push({
                    stepId: step.step,
                    success: true,
                    output: result
                });
            } catch (error: any) {
                console.error(`[Agent Executor] ❌ Error en el paso ${step.step}:`, error);
                
                // Si falla de manera irrecuperable con el error handler, cortamos de momento.
                results.push({
                    stepId: step.step,
                    success: false,
                    output: error.message
                });
                break;
            }
        }

        return `Tarea finalizada. Pasos completados: ${results.filter(r => r.success).length} de ${steps.length}`;
    }
}

import { createPlan, replan } from "./planner.js";
import { analyzeError, ErrorDecision } from "./error-handler.js";
import { executeTool } from "../actions/index.js";
import { broadcast } from "../gateway/server.js";
import { generateText } from "../providers/registry.js";
import { createLogger } from "../infra/logger.js";
import { runInLane } from "./lanes.js";

const log = createLogger("AgentExecutor");

// Session ID used for lane tracking (one per executor instance)
const EXECUTOR_SESSION = `exec_${Date.now()}`;

interface PlanStep {
    step:        number;
    tool:        string;
    description: string;
    parameters:  Record<string, any>;
    dependsOn:   number[];   // Phase 4.3: dependency graph
}

interface StepResult {
    stepId:  number;
    tool:    string;
    success: boolean;
    output:  string;
}

const MAX_RETRIES = 3;

export class AgentExecutor {
    private isCancelled = false;
    private readonly sessionId: string;

    constructor(sessionId?: string) {
        this.sessionId = sessionId || EXECUTOR_SESSION;
    }

    public cancel() {
        this.isCancelled = true;
    }

    public async executeGoal(goal: string, speakFallback?: (msg: string) => void): Promise<string> {
        log.info(`Iniciando meta global: ${goal}`);
        const plan = await createPlan(goal);
        const steps: PlanStep[] = (plan.steps || []).map((s: any) => ({
            ...s,
            dependsOn: Array.isArray(s.dependsOn) ? s.dependsOn : [],
        }));
        const results: StepResult[] = [];
        const stepOutputs: Record<string, string> = {};

        if (steps.length === 0) {
            const msg = "No pude elaborar un plan seguro para esta tarea.";
            if (speakFallback) speakFallback(msg);
            return msg;
        }

        broadcast({
            type: "task_plan",
            goal,
            steps: steps.map(s => ({ step: s.step, tool: s.tool, description: s.description }))
        });

        // â”€â”€ Phase 4.3: Parallel execution by dependency waves â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
        const completed = new Set<number>();
        let allSteps = [...steps];

        while (allSteps.length > 0 && !this.isCancelled) {
            // Find steps whose dependencies are all met
            const wave = allSteps.filter(s =>
                s.dependsOn.every(dep => completed.has(dep))
            );

            if (wave.length === 0) {
                // Circular dependency or bad plan â€” fall back to sequential
                log.warn("No hay pasos ejecutables (posible ciclo). Ejecutando secuencialmente...");
                const next = allSteps[0];
                wave.push(next);
            }

            log.info(`Ejecutando wave de ${wave.length} paso(s) en paralelo: [${wave.map(s => s.step).join(", ")}]`);

            // Execute all steps in this wave concurrently, each in its own lane
            const waveResults = await Promise.all(
                wave.map(step => this._runStep(step, stepOutputs, goal, speakFallback))
            );

            for (const r of waveResults) {
                results.push(r);
                if (r.success) {
                    completed.add(r.stepId);
                    stepOutputs[r.tool]          = r.output;
                    stepOutputs[`step_${r.stepId}`] = r.output;
                }
            }

            // Remove executed steps
            const waveIds = new Set(wave.map(s => s.step));
            allSteps = allSteps.filter(s => !waveIds.has(s.step));

            // Check for abort signal from any step
            const aborted = waveResults.find(r => (r as any)._abort);
            if (aborted) {
                const msg = (aborted as any)._abortMsg || "Tarea abortada.";
                broadcast({ type: "task_complete", success: false, summary: msg });
                return msg;
            }
        }

        if (this.isCancelled) {
            if (speakFallback) speakFallback("Tarea cancelada.");
            return "Ejecucion cancelada por el usuario.";
        }

        const successCount = results.filter(r => r.success).length;
        const summary = await this.summarize(goal, results);
        broadcast({ type: "task_complete", success: successCount === steps.length, summary });
        if (speakFallback) speakFallback(summary);
        return summary;
    }

    /**
     * Execute a single step with retries, error analysis, and lane control.
     */
    private async _runStep(
        step: PlanStep,
        stepOutputs: Record<string, string>,
        goal: string,
        speakFallback?: (msg: string) => void
    ): Promise<StepResult & { _abort?: boolean; _abortMsg?: string }> {

        broadcast({
            type: "task_progress",
            step: step.step,
            tool: step.tool,
            description: step.description,
        });

        let attempt = 0;

        while (attempt < MAX_RETRIES) {
            attempt++;
            log.info(`Step ${step.step}: [${step.tool}] ${step.description} (intento ${attempt})`);

            try {
                const injectedParams = this.injectContext(step.parameters, stepOutputs);

                // Phase 4.2: wrap tool call in lane
                const result = await runInLane(this.sessionId, () =>
                    executeTool(step.tool, injectedParams)
                );

                log.info(`Paso ${step.step} OK: ${result.substring(0, 100)}`);
                broadcast({ type: "task_step_done", step: step.step, tool: step.tool, success: true });
                return { stepId: step.step, tool: step.tool, success: true, output: result };

            } catch (error: any) {
                const errorMsg = error.message || String(error);
                log.error(`Error en paso ${step.step} (intento ${attempt}):`, errorMsg);
                const analysis = await analyzeError(step, errorMsg, attempt, goal);
                log.info(`Decision: ${analysis.decision}`);

                if (analysis.user_message && speakFallback) speakFallback(analysis.user_message);
                broadcast({ type: "task_step_error", step: step.step, tool: step.tool, error: errorMsg, decision: analysis.decision });

                switch (analysis.decision) {
                    case ErrorDecision.RETRY:
                        continue;

                    case ErrorDecision.ABORT: {
                        const abortMsg = analysis.user_message || "Tarea abortada por error irrecuperable.";
                        return { stepId: step.step, tool: step.tool, success: false, output: errorMsg, _abort: true, _abortMsg: abortMsg };
                    }

                    case ErrorDecision.SKIP:
                    default:
                        return { stepId: step.step, tool: step.tool, success: false, output: errorMsg };
                }
            }
        }

        return { stepId: step.step, tool: step.tool, success: false, output: "Max reintentos alcanzados" };
    }

    private injectContext(params: Record<string, any>, stepOutputs: Record<string, string>): Record<string, any> {
        if (!params) return params;
        const injected = { ...params };
        if (injected.action === "write" || injected.action === "create_file") {
            if (!injected.content || injected.content === "") {
                const source = stepOutputs["web_search"] || stepOutputs["screen_vision"] || stepOutputs["cmd_control"];
                if (source) injected.content = source;
            }
        }
        for (const key of Object.keys(injected)) {
            if (typeof injected[key] === "string") {
                injected[key] = injected[key].replace(
                    /{{(step_\d+|[a-z_]+)}}/g,
                    (_: string, ref: string) => stepOutputs[ref] || ""
                );
            }
        }
        return injected;
    }

    private async summarize(goal: string, results: StepResult[]): Promise<string> {
        try {
            const stepsLog = results.map(r =>
                `Paso ${r.stepId} [${r.tool}]: ${r.success ? "OK" : "FAIL"} ${r.output.substring(0, 200)}`
            ).join("\n");

            const response = await generateText({
                messages: [{
                    role: "user",
                    content: `You are a friendly AI assistant named Orbit. Summarize in 1-2 sentences IN SPANISH what was accomplished.\n\nGoal: ${goal}\nResults:\n${stepsLog}\n\nReply with ONLY the summary sentence, nothing else.`
                }],
            });
            return response.text?.trim() || `Tarea finalizada. ${results.filter(r => r.success).length}/${results.length} pasos completados.`;
        } catch {
            const s = results.filter(r => r.success).length;
            return `Tarea finalizada. ${s} de ${results.length} pasos completados.`;
        }
    }
}

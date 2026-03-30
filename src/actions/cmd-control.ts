import { exec } from "child_process";
import { promisify } from "util";
import os from "os";

const execAsync = promisify(exec);

export async function cmdControl(parameters: any): Promise<string> {
    const task = parameters?.task || "";
    const command = parameters?.command || "";
    
    if (!task && !command) {
        return "Se necesita una 'task' o 'command' para ejecutar.";
    }

    console.log(`[CMD Control] 💻 Ejecutando:`, command || task);

    try {
        // Ejecutamos en el directorio home por defecto
        const cwd = os.homedir();
        
        // Si el LLM nos dio un comando exacto lo usamos, sino generamos un comando simple (aunque Mark-XXX pre-generaba o enviaba natural language al executor, asumiendo que el prompt lo formatea a command)
        const cmdToRun = command || `powershell -NoProfile -Command "${task}"`;
        
        const { stdout, stderr } = await execAsync(cmdToRun, { cwd, timeout: 60000 });
        
        let output = stdout.trim();
        let error = stderr.trim();
        
        if (output && output.length > 3000) {
            output = output.slice(0, 3000) + "\n...[TRUNCADO]";
        }

        if (error) {
            console.warn(`[CMD Control] ⚠️ Advertencia/Error: ${error}`);
            // A veces powershell escribe warnings en stderr, seguimos si hay stdout
            if (!output) return `Error ejecutando comando: ${error}`;
        }

        return output || "Comando ejecutado exitosamente sin salida de texto.";
        
    } catch (e: any) {
        console.error(`[CMD Control] ❌ Error crítico:`, e);
        return `Comando falló: ${e.message}`;
    }
}

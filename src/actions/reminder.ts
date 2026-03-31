import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

function sanitize(text: string): string {
    return text.replace(/['"\\`$]/g, "");
}

export async function reminder(parameters: any): Promise<string> {
    const action = (parameters?.action ?? "create").toLowerCase().trim();
    const message = parameters?.message || parameters?.text || "";
    const datetime = parameters?.datetime || parameters?.time || "";
    const name = parameters?.name || `orbit_reminder_${Date.now()}`;

    console.log(`[Reminder] ${action}`, { message: message.slice(0, 40), datetime });

    try {
        switch (action) {
            case "create": {
                if (!message) return "Necesito el mensaje del recordatorio.";
                if (!datetime) return "Necesito la fecha/hora. Formato: 'YYYY-MM-DD HH:mm' o 'HH:mm' para hoy.";

                const safeName = sanitize(name);
                const safeMessage = sanitize(message);

                let triggerTime: string;
                if (/^\d{4}-\d{2}-\d{2}/.test(datetime)) {
                    triggerTime = datetime.replace("T", " ").substring(0, 16);
                } else {
                    const today = new Date().toISOString().split("T")[0];
                    triggerTime = `${today} ${datetime}`;
                }

                const script = `
$taskName = "OrbitReminder_${safeName}"
$action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument "-WindowStyle Hidden -Command \`"Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.MessageBox]::Show('${safeMessage}', 'Orbit Reminder', 'OK', 'Information') | Out-Null\`""
$trigger = New-ScheduledTaskTrigger -Once -At '${triggerTime}'
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -DeleteExpiredTaskAfterCompletion (New-TimeSpan -Hours 1)
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings -Force | Out-Null
Write-Output "ok"
`;

                const escaped = script.replace(/"/g, '\\"');
                await execAsync(
                    `powershell -NoProfile -NonInteractive -Command "${escaped}"`,
                    { timeout: 15000 }
                );
                return `Recordatorio creado: "${message}" para ${triggerTime}.`;
            }

            case "list": {
                const script = `Get-ScheduledTask -TaskName "OrbitReminder_*" -ErrorAction SilentlyContinue | ForEach-Object { $_.TaskName + " | " + ($_ | Get-ScheduledTaskInfo).NextRunTime } | Out-String`;
                const escaped = script.replace(/"/g, '\\"');
                const { stdout } = await execAsync(
                    `powershell -NoProfile -NonInteractive -Command "${escaped}"`,
                    { timeout: 10000 }
                );
                const list = stdout.trim();
                return list || "No hay recordatorios programados.";
            }

            case "delete": {
                if (!name && !parameters?.all) return "Necesito el nombre del recordatorio a eliminar.";
                if (parameters?.all) {
                    const script = `Get-ScheduledTask -TaskName "OrbitReminder_*" -ErrorAction SilentlyContinue | Unregister-ScheduledTask -Confirm:$false; Write-Output "ok"`;
                    const escaped = script.replace(/"/g, '\\"');
                    await execAsync(
                        `powershell -NoProfile -NonInteractive -Command "${escaped}"`,
                        { timeout: 10000 }
                    );
                    return "Todos los recordatorios de Orbit eliminados.";
                }
                const safeName = sanitize(name);
                const script = `Unregister-ScheduledTask -TaskName "OrbitReminder_${safeName}" -Confirm:$false; Write-Output "ok"`;
                const escaped = script.replace(/"/g, '\\"');
                await execAsync(
                    `powershell -NoProfile -NonInteractive -Command "${escaped}"`,
                    { timeout: 10000 }
                );
                return `Recordatorio '${name}' eliminado.`;
            }

            default:
                return `Accion no reconocida: '${action}'. Opciones: create, list, delete`;
        }
    } catch (e: any) {
        console.error(`[Reminder] `, e);
        return `Error en reminder: ${e.message}`;
    }
}

import screenshot from 'screenshot-desktop';
import path from 'path';
import os from 'os';
import { runPS, getCursorPos, buildBezierScript } from './ps-bridge.js';

export async function computerControl(parameters: any): Promise<string> {
    const action = (parameters?.action ?? '').toLowerCase().trim();
    if (!action) return 'Especifica una accion: type, click, double_click, right_click, move, hotkey, press, scroll, screenshot, wait, focus_window.';
    console.log(`[Computer Control] ${action}`, parameters);
    try {
        switch (action) {
            case 'type':
            case 'smart_type': {
                const text: string = parameters.text || '';
                if (!text) return 'Necesito el texto a escribir.';
                if (text.length > 5) {
                    const escaped = text.replace(/'/g, "''");
                    await runPS(`Set-Clipboard -Value '${escaped}'; [System.Windows.Forms.SendKeys]::SendWait('^v'); Start-Sleep -Milliseconds 50`);
                } else {
                    const escaped = text.replace(/[+^%~(){}[\]]/g, (c: string) => `{${c}}`).replace(/\n/g, '{ENTER}').replace(/\t/g, '{TAB}');
                    await runPS(`[System.Windows.Forms.SendKeys]::SendWait('${escaped.replace(/'/g, "''")}');`);
                }
                return `Texto escrito: ${text.slice(0, 40)}${text.length > 40 ? '...' : ''}`;
            }
            case 'click':
            case 'left_click': {
                const x = Math.round(Number(parameters.x) || 0);
                const y = Math.round(Number(parameters.y) || 0);
                const [cx, cy] = await getCursorPos();
                await runPS(buildBezierScript(cx, cy, x, y) + ' [OrbitInput]::LClick(); Write-Output "ok"');
                return `Click en (${x}, ${y})`;
            }
            case 'double_click': {
                const x = Math.round(Number(parameters.x) || 0);
                const y = Math.round(Number(parameters.y) || 0);
                const [cx, cy] = await getCursorPos();
                await runPS(buildBezierScript(cx, cy, x, y) + ' [OrbitInput]::LClick(); Start-Sleep -Milliseconds 80; [OrbitInput]::LClick(); Write-Output "ok"');
                return `Doble click en (${x}, ${y})`;
            }
            case 'right_click': {
                const x = Math.round(Number(parameters.x) || 0);
                const y = Math.round(Number(parameters.y) || 0);
                const [cx, cy] = await getCursorPos();
                await runPS(buildBezierScript(cx, cy, x, y) + ' [OrbitInput]::RClick(); Write-Output "ok"');
                return `Click derecho en (${x}, ${y})`;
            }
            case 'move':
            case 'mouse_move': {
                const x = Math.round(Number(parameters.x) || 0);
                const y = Math.round(Number(parameters.y) || 0);
                const [cx, cy] = await getCursorPos();
                await runPS(buildBezierScript(cx, cy, x, y) + ' Write-Output "ok"');
                return `Raton movido a (${x}, ${y})`;
            }
            case 'scroll': {
                const dir = (parameters.direction || 'down').toLowerCase();
                const amount = Number(parameters.amount) || 3;
                const scrollAmt = dir === 'down' || dir === 'right' ? -amount : amount;
                await runPS(`[OrbitInput]::Scroll(${scrollAmt}); Write-Output "ok"`);
                return `Scroll ${dir} x${amount}`;
            }
            case 'hotkey': {
                const keys: string = (parameters.keys || 'ctrl+c').toLowerCase();
                let fmt = keys.replace(/ctrl\+/g, '^').replace(/alt\+/g, '%').replace(/shift\+/g, '+').replace(/win\+/g, '^{ESC}');
                const parts = fmt.match(/[\^%+]*/g)?.join('') || '';
                const key = fmt.replace(/[\^%+]/g, '');
                if (key.length > 1) fmt = `${parts}{${key.toUpperCase()}}`;
                await runPS(`[System.Windows.Forms.SendKeys]::SendWait('${fmt}');`);
                return `Atajo ejecutado: ${keys}`;
            }
            case 'press': {
                const key: string = parameters.key || 'enter';
                const keyMap: Record<string, string> = {
                    enter: '{ENTER}', tab: '{TAB}', escape: '{ESC}', esc: '{ESC}',
                    backspace: '{BS}', delete: '{DEL}', space: ' ',
                    up: '{UP}', down: '{DOWN}', left: '{LEFT}', right: '{RIGHT}',
                    home: '{HOME}', end: '{END}', pgup: '{PGUP}', pgdn: '{PGDN}',
                    f1: '{F1}', f2: '{F2}', f3: '{F3}', f4: '{F4}',
                    f5: '{F5}', f6: '{F6}', f7: '{F7}', f8: '{F8}',
                    f9: '{F9}', f10: '{F10}', f11: '{F11}', f12: '{F12}',
                };
                const sendKey = keyMap[key.toLowerCase()] ?? `{${key.toUpperCase()}}`;
                await runPS(`[System.Windows.Forms.SendKeys]::SendWait('${sendKey}');`);
                return `Tecla pulsada: ${key}`;
            }
            case 'screenshot': {
                const tempPath = path.join(os.tmpdir(), `orbit_ss_${Date.now()}.png`);
                await screenshot({ filename: tempPath });
                return `Captura guardada en: ${tempPath}`;
            }
            case 'wait':
            case 'sleep': {
                const secs = Math.min(Number(parameters.seconds) || 1, 30);
                await new Promise(r => setTimeout(r, secs * 1000));
                return `Espere ${secs} segundos.`;
            }
            case 'focus_window': {
                const appName: string = parameters.app || parameters.description || '';
                if (!appName) return 'Necesito el nombre de la ventana.';
                await runPS(`$wshell = New-Object -ComObject WScript.Shell; $wshell.AppActivate('${appName.replace(/'/g, "''")}');`);
                return `Ventana activada: ${appName}`;
            }
            case 'screen_find':
            case 'screen_click':
                return `Accion '${action}' requiere vision. Usa vision_detect primero.`;
            default:
                return `Accion no reconocida: '${action}'.`;
        }
    } catch (e: any) {
        console.error(`[Computer Control] Error:`, e);
        return `Error en computerControl (${action}): ${e.message}`;
    }
}

import { browserControl } from "./browser-control.js";

async function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

export async function sendMessage(parameters: any): Promise<string> {
    const platform = (parameters?.platform || "whatsapp").toLowerCase().trim();
    const contact = parameters?.contact || parameters?.phone || parameters?.to || "";
    const message = parameters?.message || parameters?.text || "";

    if (!message) return "Necesito el mensaje a enviar.";

    console.log(`[Send Message] ${platform} -> ${contact}: ${message.slice(0, 40)}...`);
    try {
        switch (platform) {
            case "whatsapp": {
                if (!contact) return "Necesito el numero de telefono o nombre del contacto.";
                const isPhone = /^\+?\d[\d\s\-]{6,}$/.test(contact.trim());
                if (isPhone) {
                    const cleanNumber = contact.replace(/[\s\-+]/g, "");
                    const encoded = encodeURIComponent(message);
                    await browserControl({
                        action: "go_to",
                        url: `https://wa.me/${cleanNumber}?text=${encoded}`,
                    });
                    await sleep(3000);
                    await browserControl({
                        action: "click",
                        selector: 'a[href*="send"]',
                    });
                    await sleep(4000);
                    await browserControl({
                        action: "click",
                        selector: 'span[data-icon="send"]',
                    });
                    return `Mensaje enviado por WhatsApp a ${contact}.`;
                }
                await browserControl({ action: "go_to", url: "https://web.whatsapp.com" });
                await sleep(5000);
                await browserControl({
                    action: "click",
                    selector: 'div[contenteditable="true"][data-tab="3"]',
                });
                await sleep(500);
                await browserControl({
                    action: "type",
                    selector: 'div[contenteditable="true"][data-tab="3"]',
                    text: contact,
                });
                await sleep(2000);
                await browserControl({ action: "click", selector: 'span[title]' });
                await sleep(1000);
                await browserControl({
                    action: "type",
                    selector: 'div[contenteditable="true"][data-tab="10"]',
                    text: message,
                });
                await sleep(500);
                await browserControl({ action: "click", selector: 'span[data-icon="send"]' });
                return `Mensaje enviado por WhatsApp a ${contact}.`;
            }

            case "telegram": {
                if (!contact) return "Necesito el nombre de usuario de Telegram.";
                const username = contact.startsWith("@") ? contact.slice(1) : contact;
                await browserControl({
                    action: "go_to",
                    url: `https://web.telegram.org/k/#@${username}`,
                });
                await sleep(4000);
                await browserControl({
                    action: "type",
                    selector: 'div.input-message-input[contenteditable="true"]',
                    text: message,
                });
                await sleep(500);
                await browserControl({ action: "click", selector: "button.send" });
                return `Mensaje enviado por Telegram a @${username}.`;
            }

            default:
                return `Plataforma '${platform}' no soportada. Opciones: whatsapp, telegram`;
        }
    } catch (e: any) {
        console.error(`[Send Message] `, e);
        return `Error enviando mensaje por ${platform}: ${e.message}`;
    }
}

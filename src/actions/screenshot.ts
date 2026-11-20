import screenshot from "screenshot-desktop";

export async function captureDesktopPng(): Promise<Buffer> {
    const buffer = await screenshot({ format: "png" });
    if (!Buffer.isBuffer(buffer) || buffer.length < 24) throw new Error("Orbit no pudo capturar la pantalla.");
    return buffer;
}

export function pngDimensions(buffer: Buffer): { width: number; height: number } {
    if (buffer.length >= 24 && buffer[0] === 0x89 && buffer[1] === 0x50) {
        return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
    }
    return { width: 0, height: 0 };
}

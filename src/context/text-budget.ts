function isHighSurrogate(codeUnit: number): boolean {
    return codeUnit >= 0xd800 && codeUnit <= 0xdbff;
}

function isLowSurrogate(codeUnit: number): boolean {
    return codeUnit >= 0xdc00 && codeUnit <= 0xdfff;
}

export function sliceUtf16Safe(input: string, start: number, end?: number): string {
    const len = input.length;
    let from = start < 0 ? Math.max(len + start, 0) : Math.min(start, len);
    let to = end === undefined ? len : end < 0 ? Math.max(len + end, 0) : Math.min(end, len);
    if (to <= from) return "";
    if (from > 0 && from < len) {
        const codeUnit = input.charCodeAt(from);
        if (isLowSurrogate(codeUnit) && isHighSurrogate(input.charCodeAt(from - 1))) from += 1;
    }
    if (to > 0 && to < len) {
        const codeUnit = input.charCodeAt(to - 1);
        if (isHighSurrogate(codeUnit) && isLowSurrogate(input.charCodeAt(to))) to -= 1;
    }
    return input.slice(from, to);
}

export function boundToolResult(output: string, maxChars = 12_000): string {
    if (output.length <= maxChars) return output;
    const marker = "\n[Resultado intermedio omitido por longitud]\n";
    if (maxChars <= marker.length) return sliceUtf16Safe(output, 0, maxChars);
    const keep = maxChars - marker.length;
    const head = Math.floor(keep * 0.75);
    return sliceUtf16Safe(output, 0, head) + marker + sliceUtf16Safe(output, -(keep - head));
}

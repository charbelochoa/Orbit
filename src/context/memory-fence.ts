export function buildMemoryContextBlock(memory: string): string {
    if (!memory.trim()) return "";
    const payload = JSON.stringify({ recalled: memory }).replaceAll("<", "\\u003c");
    return `<memory-context>\n${payload}\n</memory-context>`;
}

export function fenceRecalledContext(text: string): string {
    const visible = text.replace(/(^|\n)[ \t]*<memory-context>[ \t]*(?:\r?\n|$)[\s\S]*?(?:<\/memory-context>|$)/gi, "$1");
    return visible === text ? text : visible.trim();
}

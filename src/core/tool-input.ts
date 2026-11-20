type Schema = Record<string, unknown>;

function record(value: unknown): value is Schema {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function findToolInputError(schema: Schema, input: unknown, field = "args"): string | undefined {
    if (input === null && schema.nullable === true) return undefined;
    if (Array.isArray(schema.enum) && !schema.enum.includes(input)) {
        return `${field} debe ser uno de los valores declarados.`;
    }
    const type = typeof schema.type === "string" ? schema.type.toLowerCase() : undefined;
    switch (type) {
        case "object":
            if (!record(input)) return `${field} debe ser un objeto.`;
            if (Array.isArray(schema.required)) {
                const missing = schema.required.find(key => typeof key === "string" && !Object.hasOwn(input, key));
                if (typeof missing === "string") return `Falta ${field}.${missing}.`;
            }
            if (record(schema.properties)) {
                for (const [key, property] of Object.entries(schema.properties)) {
                    if (!record(property) || !Object.hasOwn(input, key)) continue;
                    const error = findToolInputError(property, input[key], `${field}.${key}`);
                    if (error) return error;
                }
            }
            break;
        case "array":
            if (!Array.isArray(input)) return `${field} debe ser una lista.`;
            if (record(schema.items)) {
                for (const [index, item] of input.entries()) {
                    const error = findToolInputError(schema.items, item, `${field}[${index}]`);
                    if (error) return error;
                }
            }
            break;
        case "string":
            if (typeof input !== "string") return `${field} debe ser texto.`;
            break;
        case "boolean":
            if (typeof input !== "boolean") return `${field} debe ser verdadero o falso.`;
            break;
        case "integer":
            if (typeof input !== "number" || !Number.isSafeInteger(input)) return `${field} debe ser un entero.`;
            break;
        case "number":
            if (typeof input !== "number" || !Number.isFinite(input)) return `${field} debe ser un número.`;
            break;
    }
    return undefined;
}

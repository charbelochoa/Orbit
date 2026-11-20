import { AsyncLocalStorage } from "node:async_hooks";

export interface ProviderSelection {
    providerId: string;
    model: string;
    allowFallback: boolean;
}

const selections = new AsyncLocalStorage<ProviderSelection | undefined>();

export function currentProviderSelection(): ProviderSelection | undefined {
    return selections.getStore();
}

export function withProviderSelection<T>(selection: ProviderSelection | undefined, operation: () => T): T {
    return selections.run(selection, operation);
}

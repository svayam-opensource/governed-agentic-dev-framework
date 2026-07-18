import type { GovHome } from "./types.js";
/** Read/write access to the multi-home registry. */
export interface RegistryStore {
    readHomes(): GovHome[];
    writeHomes(homes: readonly GovHome[]): void;
    readActiveOrg(): string | null;
    writeActiveOrg(org: string): void;
    clearActiveOrg(): void;
}
export interface RegistryStoreOptions {
    readonly configDir?: string;
    readonly home?: string;
}
/** A node:fs-backed {@link RegistryStore}. */
export declare function createNodeRegistryStore(opts?: RegistryStoreOptions): RegistryStore;

/**
 * `gov-work org add|use|list|remove` (SDD Part D) — manage the CLI-local multi-home
 * registry that the resolver reads. `add` validates that the home really is that
 * org's gov repo (via govConfigAt) before recording it, so the resolver's rule-b
 * pointer check can trust it. Pure over the RegistryStore + a gov-repo probe.
 */
import type { RegistryStore } from "./registry-store.js";
import type { GovConfig } from "./types.js";
export interface OrgDeps {
    readonly store: RegistryStore;
    /** Probe a path's gov config (the resolver's `govConfigAt`). */
    govConfigAt(path: string): GovConfig | null;
}
export type OrgResult = {
    readonly ok: true;
    readonly lines: readonly string[];
} | {
    readonly ok: false;
    readonly code: number;
    readonly message: string;
};
/** Register (or update) a gov home for `org` at the absolute `homePath`. */
export declare function orgAdd(deps: OrgDeps, org: string, homePath: string): OrgResult;
/** Select the active org (must already be registered). */
export declare function orgUse(deps: OrgDeps, org: string): OrgResult;
/** List registered homes, marking the active one. */
export declare function orgList(deps: OrgDeps): OrgResult;
/** Remove an org's home; clears active-org if it was the one removed. */
export declare function orgRemove(deps: OrgDeps, org: string): OrgResult;

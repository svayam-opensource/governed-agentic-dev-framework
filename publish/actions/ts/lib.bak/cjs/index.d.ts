/**
 * @svayam-opensource/gov-work — the OSS core of the `prj` governance CLI.
 *
 * Migration in flight: Bash → Node 24 / TypeScript, for AD-6.1 conformance
 * (the legacy Bash CLI is a non-conformant deviation and the root cause of the
 * MSYS/Windows CI pain, issue #90). Same phase-by-phase, CI-green, TDD discipline
 * that delivered prj-operate. Blueprint: units/prj-work/SDD.md (PRJ-43).
 *
 * Phase 0 (this): package scaffold + CI, plus the typed migration roadmap below.
 * Phase 1: `prj_resolve_gov` deterministic resolver (SDD-013/040) + registry model.
 * Later phases follow the SDD's four operation categories.
 */
/** The four operation categories of prj-work (SDD §PART B–E). */
export declare const OPERATION_CATEGORIES: readonly ["lifecycle", "governance", "org-registry", "publish"];
export type OperationCategory = (typeof OPERATION_CATEGORIES)[number];
/** A single migration phase in the Bash → Node/TS port. */
export interface MigrationPhase {
    readonly phase: number;
    readonly title: string;
    /** Operation categories this phase begins to cover. */
    readonly categories: readonly OperationCategory[];
}
/** The planned migration phases (from HANDOFF.md + SDD.md). Phase 0 is done when CI is green. */
export declare const MIGRATION_PHASES: readonly MigrationPhase[];
/** Package identity — the transitional Node name; promoted to the package root at cutover. */
export declare const PACKAGE_NAME: "@svayam-opensource/gov-work";
export * from "./resolve/index.js";
export * from "./lifecycle/index.js";
export * from "./config/org-config.js";
export * from "./governance/index.js";
export * from "./maintain/index.js";
export * from "./cli/index.js";

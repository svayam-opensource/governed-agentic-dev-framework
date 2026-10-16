// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd. — part of the OSS governed-agentic-dev-framework.
/**
 * PACKAGE IDENTITY — the constants the package root (src/index.ts) exports, in a LEAF module that imports nothing
 * (PRJ-121 intent 05, Item 12). They lived in the barrel itself, and `maintain/upgrade.ts` imported PACKAGE_NAME
 * back from it: loading the published entry ran upgrade.ts before the barrel had defined the name, so
 * `import "@svayam-opensource/gov"` threw "Cannot access 'PACKAGE_NAME' before initialization". Modules inside
 * src/ import from here, never from a barrel (eslint `no-restricted-imports`).
 */

/** The four operation categories of prj-work (SDD §PART B–E). */
export const OPERATION_CATEGORIES = [
  "lifecycle", // seed / task / merge / close … (SDD Part B)
  "governance", // session-start gate, knowledge layers, validate (SDD Part C)
  "org-registry", // multi-home resolution, org + assignment mgmt (SDD Part D)
  "publish", // governed npm publish, deps, doctor (SDD Part E)
] as const;

export type OperationCategory = (typeof OPERATION_CATEGORIES)[number];

/** A single migration phase in the Bash → Node/TS port. */
export interface MigrationPhase {
  readonly phase: number;
  readonly title: string;
  /** Operation categories this phase begins to cover. */
  readonly categories: readonly OperationCategory[];
}

/** The planned migration phases (from HANDOFF.md + SDD.md). Phase 0 is done when CI is green. */
export const MIGRATION_PHASES: readonly MigrationPhase[] = [
  { phase: 0, title: "scaffold + CI", categories: [] },
  { phase: 1, title: "prj_resolve_gov resolver + registry", categories: ["org-registry"] },
  { phase: 2, title: "project lifecycle (seed/task/merge/close)", categories: ["lifecycle"] },
  { phase: 3, title: "governance (session-gate, knowledge, validate)", categories: ["governance"] },
  { phase: 4, title: "org / multi-home", categories: ["org-registry"] },
  { phase: 5, title: "publish / self-update", categories: ["publish"] },
] as const;

/** Package identity — the transitional Node name; promoted to the package root at cutover. */
export const PACKAGE_NAME = "@svayam-opensource/gov" as const;

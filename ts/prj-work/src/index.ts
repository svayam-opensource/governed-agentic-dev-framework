// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd. — part of the OSS governed-agentic-dev-framework.
/**
 * @svayam-opensource/prj-work — the OSS core of the `prj` governance CLI.
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
export const PACKAGE_NAME = "@svayam-opensource/prj-work" as const;

// Phase 1 — governance-home resolution (SDD-013/040/041/042).
export * from "./resolve/index.js";

// Phase 2 — project lifecycle (SDD Part B): seed / task / merge / close.
export * from "./lifecycle/index.js";

// Org config (SDD-012) — the one remaining repo config file.
export * from "./config/org-config.js";

// Phase 3 — governance (SDD Part C): the validation suite.
export * from "./governance/index.js";

// The prj dispatcher (SDD-011): argv parsing + command routing.
export * from "./cli/index.js";

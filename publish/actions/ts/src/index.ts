// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd. — part of the OSS governed-agentic-dev-framework.
/**
 * @svayam-opensource/gov — the OSS core of the `prj` governance CLI.
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

// Package identity and the migration roadmap — defined in a leaf, so a module inside src/ can import them without
// importing this barrel (a load-order cycle: PRJ-121 intent 05, Item 12).
export * from "./package-identity.js";

// Phase 1 — governance-home resolution (SDD-013/040/041/042).
export * from "./resolve/index.js";

// Phase 2 — project lifecycle (SDD Part B): seed / task / merge / close.
export * from "./lifecycle/index.js";

// Org config (SDD-012) — the one remaining repo config file.
export * from "./config/org-config.js";

// Phase 3 — governance (SDD Part C): the validation suite.
export * from "./governance/index.js";

// Publish / maintain (SDD Part E).
export * from "./maintain/index.js";

// The prj dispatcher (SDD-011): argv parsing + command routing.
export * from "./cli/index.js";

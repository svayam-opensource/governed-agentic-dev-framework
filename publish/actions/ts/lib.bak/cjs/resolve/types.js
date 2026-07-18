// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * Types for `prjResolveGov` — the deterministic governance-home resolver
 * (SDD-013 / SDD-040) and the CLI-local multi-home registry (SDD-041 / SDD-042).
 *
 * Resolution model (active-org is the anchor; cwd-walk is a cross-check):
 *   O1 = active-org      — the developer's declared current org (mandatory)
 *   O2 = cwd-walk org    — the org whose workspace cwd sits in, or none
 *
 *   O1 unset                → hardstop (choose an org)                 [rule a]
 *   O2 present and O2 ≠ O1   → hardstop (conflict — pick the org)
 *   O2 == O1                → resolve to the cwd workspace
 *   O2 == none              → resolve to O1's registry home, double-checked [rule b]
 *   O1 set but no home       → hardstop (register a home)
 *
 * The resolver is PURE and SIDE-EFFECT-FREE — it only reads. The registry is
 * populated by `gov-work org add` / setup, never by resolution (no self-heal), so a
 * transient project-clone path can never pollute it.
 */
export {};

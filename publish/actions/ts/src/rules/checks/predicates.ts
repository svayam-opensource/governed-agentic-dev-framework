// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * THE SEVEN PREDICATES, AS A CHECK BINDING RUNS THEM (rule-model-design.md Q13; P3 cutover, 2026-10-06).
 *
 * These are the `gov-builtin/<kind>` actions of the catalog. They were born as the inline `gov:check` comments of
 * the old notation; that notation is retired (a check now lives in a rule row and is bound to a resource event),
 * but the predicates themselves — and the two engines that evaluate them, `diff-check.ts` over a changeset and
 * `verb-gate.ts` over a workspace — are what the check engine runs. The shared vocabulary lives here so neither
 * engine depends on a parser that no longer exists.
 *
 * Types and constants only.
 */

/**
 * The predicates. Deliberately few: an organization needing more authors an action (`policies/actions/`),
 * reviewed by the Check Owner, rather than gov growing a language.
 */
export const CHECK_KINDS = [
  "naming", "path-scope", "list-membership", "content-forbidden", "content-required", "file-required",
  "frontmatter-required",
] as const;
export type CheckKind = (typeof CHECK_KINDS)[number];

/** The gov verbs a check may gate — the events of the catalog's `gov.verb` resource. */
export const GATEABLE_VERBS = ["close", "merge", "task", "seed", "knowledge"] as const;
export type GateableVerb = (typeof GATEABLE_VERBS)[number];

/** What makes a predicate run: a changed file, or an invoked verb. */
export type Trigger =
  | { readonly on: "files"; readonly globs: readonly string[] }
  | { readonly on: "verb"; readonly verb: GateableVerb };

/** One predicate, ready to evaluate. */
export interface Check {
  readonly kind: CheckKind;
  readonly trigger: Trigger;
  /** The predicate's parameters, in their comma-joined string form (`list=`, `pattern=`, `require=`, …). */
  readonly attrs: Readonly<Record<string, string>>;
  /** What happens when the predicate does not hold. */
  readonly onMiss: "fail" | "warn";
}

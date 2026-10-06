// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * THE TWO RULE STORES, READ AT A GIT REF — and the one issuer of GOV ids (rule-model-design.md Q5, Q7, Q8, Q17;
 * W1, 2026-10-06). The disk side of {@link ./rule-row.js} and {@link ./catalog.js}.
 *
 * AT A REF, NEVER FROM THE WORKTREE. Rules are what the default branch says (GOV-FRM-456). A branch that deletes a
 * row from its own `policies/rules.yaml` has proposed a change, not made one — and a reader that looked at the
 * worktree would let the branch under review unbind itself. The mechanism is the one `cli/policy-gate-io.ts`
 * already uses: `git ls-tree` to learn what EXISTS at the ref, `git show <ref>:<path>` to read it, with git
 * injected so every path here is testable without a repository.
 *
 * THREE ANSWERS, KEPT APART. A careless reader collapses them, and two of the three collapses are silent passes:
 *
 *   an org with no rules yet   → an EMPTY org store. A fresh adopter has no `policies/rules.yaml`; that is a
 *                                state, not a fault.
 *   rules that are wrong       → the rows, WITH diagnostics. A row in the wrong scope is still a row somebody
 *                                wrote; hiding it would hide the mistake.
 *   gov could not tell         → `ok: false` with the reason (and `null` from {@link RuleStoreReader.load}).
 *                                git that cannot answer, a file listed but unreadable, YAML that does not parse,
 *                                no org scope. Never read as "no rules": that is how a broken checkout passes.
 *
 * WHY THE DIAGNOSTICS RIDE BESIDE THE SET rather than inside it: `RuleSet` is a P1 contract every workstream
 * consumes, and the shape that says what is broken belongs to whoever reports it (CI, doctor), not to every
 * consumer of the rows. {@link loadRuleStores} returns both; the contract's `load` returns the set alone.
 */
import { readTopLevelScalar } from "../../resolve/node-env.js";
import type { GitRead } from "../../cli/policy-gate-io.js";
import { log } from "../../log.js";
import { FRAMEWORK_SCOPE, isScope, issueId } from "./gov-id.js";
import { parseRuleStore, validateRuleStore, inForce, type RuleRow, type RowDiagnosticKind } from "./rule-row.js";
import { parseCatalog, mergeCatalogs, validateBindings, type Catalog, type BindingDiagnosticKind } from "./catalog.js";
import type { RuleSet, RuleStoreReader, IdIssuer } from "./contracts.js";
import { resolveRoles, roleHandles, ROLE_LIST_PATH } from "../../config/role-list.js";

/** Where each piece lives, repo-relative. One table, so a layout change is one edit. */
export const RULE_STORE_PATHS = {
  frameworkRules: "framework/rules/rules.yaml",
  frameworkCatalog: "framework/rules/catalog.yaml",
  orgRules: "policies/rules.yaml",
  orgCatalog: "policies/catalog.yaml",
  orgVersion: "policies/VERSION",
  orgConfig: "org-config.yaml",
  /** The org's role list (W2-Q5): role → holder → knowledge/ folders, a table in this seed-once document. */
  roleList: ROLE_LIST_PATH,
} as const;

/** The version an org with no policy history stands at. Its first rule-changing PR bumps it to 0.1.0. */
export const NO_ORG_VERSION = "0.0.0";

export type StoreNoteKind = "missing-framework-store" | "missing-framework-catalog" | "missing-version";

export interface StoreDiagnostic {
  /** Which store the finding is about. Binding findings are the store of the row that binds. */
  readonly store: "framework" | "org";
  readonly kind: RowDiagnosticKind | BindingDiagnosticKind | StoreNoteKind;
  /** The GOV id concerned, or "" for a finding about a whole file. */
  readonly id: string;
  readonly message: string;
}

export type RuleStoreLoad =
  | { readonly ok: true; readonly set: RuleSet; readonly diagnostics: readonly StoreDiagnostic[] }
  | { readonly ok: false; readonly reason: string };

/**
 * Read both stores, both catalogs, the org's policy version and its scope, at `ref`.
 *
 * Pure over `git`. `repo` is the governance repository (or any worktree of it — they share the object store).
 */
export function loadRuleStores(git: GitRead, repo: string, ref: string): RuleStoreLoad {
  const P = RULE_STORE_PATHS;
  // ONE LISTING, so "absent" is a fact git stated rather than an inference from a failed `show`. A `show` that
  // fails on a path the listing named is git failing, and is reported as such.
  const listing = git(repo, ["ls-tree", "-r", "--name-only", ref, "--", "framework/rules", "policies", P.orgConfig]);
  if (listing === null) return refuse(`could not list the rule stores at ${ref} (git did not answer)`, ref);
  const present = new Set(listing.split("\n").map((l) => l.trim()).filter(Boolean));

  /** The file's text; `undefined` when the ref has no such file; `null` when git could not read one it listed. */
  const read = (rel: string): string | undefined | null => (present.has(rel) ? git(repo, ["show", `${ref}:${rel}`]) : undefined);

  const texts: Partial<Record<keyof typeof P, string | undefined>> = {};
  for (const [k, rel] of Object.entries(P) as [keyof typeof P, string][]) {
    const t = read(rel);
    if (t === null) return refuse(`${rel} is at ${ref} but git could not read it`, ref);
    texts[k] = t;
  }

  if (texts.orgConfig === undefined) return refuse(`no ${P.orgConfig} at ${ref}, so the org store has no scope`, ref);
  // Uppercased: setup has accepted a lowercase slug, and an id's scope is written in capitals (gov-id.ts).
  const orgScope = (readTopLevelScalar(texts.orgConfig, "org_slug") ?? "").trim().toUpperCase();
  if (!orgScope) return refuse(`${P.orgConfig} at ${ref} has no org_slug, so the org store has no scope`, ref);
  if (orgScope === FRAMEWORK_SCOPE) return refuse(`org_slug "${orgScope}" is reserved for the framework's own rules`, ref);
  if (!isScope(orgScope)) return refuse(`org_slug "${orgScope}" is not a usable rule scope (2–6 letters/digits, starting with a letter)`, ref);

  let framework: RuleRow[], org: RuleRow[], fCat: Catalog, oCat: Catalog;
  const parse = <T>(rel: string, text: string | undefined, empty: T, fn: (s: string) => T): T => {
    if (text === undefined) return empty;
    try { return fn(text); } catch (e) { throw new StoreParseError(`${rel} at ${ref} does not parse: ${(e as Error).message}`); }
  };
  try {
    framework = parse(P.frameworkRules, texts.frameworkRules, [], parseRuleStore);
    org = parse(P.orgRules, texts.orgRules, [], parseRuleStore);
    fCat = parse(P.frameworkCatalog, texts.frameworkCatalog, parseCatalog(""), parseCatalog);
    oCat = parse(P.orgCatalog, texts.orgCatalog, parseCatalog(""), parseCatalog);
  } catch (e) {
    if (e instanceof StoreParseError) return refuse(e.message, ref);
    throw e;
  }
  const catalog = mergeCatalogs(fCat, oCat);
  const orgVersion = texts.orgVersion?.trim() || NO_ORG_VERSION;

  const diagnostics: StoreDiagnostic[] = [];
  const note = (store: "framework" | "org", kind: StoreNoteKind, message: string) => diagnostics.push({ store, kind, id: "", message });
  // NOTED, NOT REFUSED: an org on the pre-rule-model layout has neither, and must still load — its own rules
  // are real. The note is what keeps "the framework has no rules" from being read as "the framework has no rules".
  if (texts.frameworkRules === undefined) note("framework", "missing-framework-store", `no ${P.frameworkRules} at ${ref} — run \`gov upgrade\` to install the framework's rules`);
  if (texts.frameworkCatalog === undefined) note("framework", "missing-framework-catalog", `no ${P.frameworkCatalog} at ${ref} — no resource can be bound until \`gov upgrade\` installs it`);
  if (org.length > 0 && texts.orgVersion === undefined) note("org", "missing-version", `${P.orgRules} has rows but there is no ${P.orgVersion} at ${ref} — the rows cite a version nobody recorded`);

  for (const [store, rows, scope] of [["framework", framework, FRAMEWORK_SCOPE], ["org", org, orgScope]] as const) {
    for (const d of validateRuleStore(rows, { scope })) diagnostics.push({ store, kind: d.kind, id: d.id, message: d.message });
    // Bindings of the rows IN FORCE only: a retired revision may name an action the catalog has since dropped,
    // and that is history, not a fault.
    for (const row of inForce(rows)) for (const d of validateBindings(row, catalog)) diagnostics.push({ store, kind: d.kind, id: d.id, message: d.message });
  }

  log("debug", "rule stores loaded", "gov-work:rules:store-io", "loadRuleStores", {
    ref, framework: framework.length, org: org.length, orgScope, orgVersion, diagnostics: diagnostics.length,
  });
  // WHO HOLDS EACH ROLE, at the same ref: the Policy Owner and Check Owner from org-config, every other role from the
  // org's role list — or, while an org's copy of the document has no table, the legacy *_owner_github keys.
  const roles = roleHandles(texts.orgConfig, resolveRoles(texts.orgConfig, texts.roleList).roles);
  return { ok: true, set: { framework, org, orgScope, catalog, orgVersion, roles }, diagnostics };
}

class StoreParseError extends Error {}

function refuse(reason: string, ref: string): RuleStoreLoad {
  log("info", "rule stores could not be read — reported as cannot-tell", "gov-work:rules:store-io", "loadRuleStores", { ref, reason });
  return { ok: false, reason };
}

/** The P1 contract: the set, or `null` when gov could not tell. Callers that must say WHY use {@link loadRuleStores}. */
export function createRuleStoreReader(git: GitRead, repo: string): RuleStoreReader {
  return {
    load(ref: string): RuleSet | null {
      const r = loadRuleStores(git, repo, ref);
      return r.ok ? r.set : null;
    },
  };
}

/**
 * Every GOV id present anywhere in either store — every revision, retired ones included, in first-seen order.
 *
 * The stores are append-only histories (rule-row.ts), so "present in the store" IS "ever issued": a retired rule
 * keeps its closed rows, and its number with them.
 */
export function everIssuedIds(set: Pick<RuleSet, "framework" | "org">): string[] {
  return [...new Set([...set.framework, ...set.org].map((r) => r.id))];
}

/**
 * An issuer seeded with what was ever issued. STATEFUL ON PURPOSE: one proposal may add several rules, and an
 * issuer that forgot what it had just handed out would number them all the same. It throws on a malformed scope
 * (see `issueId`) rather than issue an id nobody can parse back.
 */
export function createIdIssuer(everIssued: readonly string[]): IdIssuer {
  const issued = [...everIssued];
  return {
    next(scope: string): string {
      const id = issueId(issued, scope);
      issued.push(id);
      return id;
    },
  };
}

/** The issuer for a loaded rule set: next id = one past the highest ever present in that scope. */
export const idIssuerAt = (set: Pick<RuleSet, "framework" | "org">): IdIssuer => createIdIssuer(everIssuedIds(set));

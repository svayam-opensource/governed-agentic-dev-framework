// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * THE RULE SET A CHECK RUNS AGAINST — W1's stores, plus who owns what (W2-Q8; W6 slice 3).
 *
 * {@link loadRuleStores} gives the rows, the catalog and `roles` (role → handle). A check that routes approval also
 * needs `ownership` (`policies/ownership.yaml`), which it leaves out. Both are read at the SAME default-branch ref as
 * the rules, never from the branch under review — a pull request that handed its own section to its author, or
 * named its author a role's holder, would otherwise approve itself.
 *
 * Roles come with the stores (store-io.ts): the Policy Owner and Check Owner (vacant → the Policy Owner) from
 * org-config, and every other role from the org's role list in `policies/authorized-representatives.md`. A section
 * owned by a VACANT role — or by a role the list does not name — routes to the Policy Owner; never a pass.
 */
import type { GitRead } from "../../cli/policy-gate-io.js";
import { loadRuleStores } from "../model/store-io.js";
import type { RuleSet, SectionOwnership } from "../model/contracts.js";
import { OWNERSHIP_PATH, parseOwnership } from "./ownership.js";

export { OWNERSHIP_PATH };

/** The default branch as this checkout has it: `origin/<b>` when fetched (CI), else `<b>`. */
export function defaultRef(git: GitRead, repo: string, branch: string): string {
  return git(repo, ["rev-parse", "--verify", "--quiet", `origin/${branch}`]) !== null ? `origin/${branch}` : branch;
}

export type CheckRuleSetLoad = { readonly ok: true; readonly set: RuleSet } | { readonly ok: false; readonly reason: string };

export function loadCheckRuleSet(git: GitRead, repo: string, ref: string): CheckRuleSetLoad {
  const r = loadRuleStores(git, repo, ref);
  if (!r.ok) return r;
  // Listed first, so "absent" (every section is the Policy Owner's) is not confused with "unreadable".
  const listed = (git(repo, ["ls-tree", "--name-only", ref, "--", OWNERSHIP_PATH]) ?? "").trim() === OWNERSHIP_PATH;
  let ownership: SectionOwnership[] = [];
  if (listed) {
    const text = git(repo, ["show", `${ref}:${OWNERSHIP_PATH}`]);
    if (text === null) return { ok: false, reason: `${OWNERSHIP_PATH} is at ${ref} but git could not read it` };
    const parsed = parseOwnership(text);
    if ("error" in parsed) return { ok: false, reason: `${OWNERSHIP_PATH} at ${ref} ${parsed.error}` };
    ownership = parsed;
  }
  return { ok: true, set: { ...r.set, ownership } };
}

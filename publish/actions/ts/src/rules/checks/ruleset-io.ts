// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * THE RULE SET A CHECK RUNS AGAINST — W1's stores, plus who owns what (W2-Q8; W6 slice 3).
 *
 * {@link loadRuleStores} gives the rows and the catalog. A check that routes approval also needs the two things it
 * leaves out of the contract's optional fields: `ownership` (`policies/ownership.yaml`) and `roles` (role → handle).
 * Both are read at the SAME default-branch ref as the rules, never from the branch under review — a pull request
 * that handed its own section to its author would otherwise approve itself.
 *
 * Roles here are the two the framework fixes: the Policy Owner (`policy_owner_github`) and the Check Owner
 * (`check_owner_github`, vacant → the Policy Owner). The org's own role list (`authorized-representatives.md`) is
 * not parsed yet: a section owned by such a role reads as vacant, and section-owner-approval routes it to the
 * Policy Owner — the documented fallback, never a pass.
 */
import { readTopLevelScalar } from "../../resolve/node-env.js";
import type { GitRead } from "../../cli/policy-gate-io.js";
import { loadRuleStores, RULE_STORE_PATHS } from "../model/store-io.js";
import type { RuleSet, SectionOwnership } from "../model/contracts.js";
import { CHECK_OWNER, POLICY_OWNER } from "./policy-actions.js";
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
  const cfg = git(repo, ["show", `${ref}:${RULE_STORE_PATHS.orgConfig}`]) ?? "";
  const handle = (key: string): string => (readTopLevelScalar(cfg, key) ?? "").trim();
  const policyOwner = handle("policy_owner_github");
  const checkOwner = handle("check_owner_github") || policyOwner;
  const roles: Record<string, string> = {};
  if (policyOwner) roles[POLICY_OWNER] = policyOwner;
  if (checkOwner) roles[CHECK_OWNER] = checkOwner;

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
  return { ok: true, set: { ...r.set, ownership, roles } };
}

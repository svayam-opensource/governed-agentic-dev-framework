// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * NAME THE PULL REQUEST IN A POLICY CHANGE THE AUTHOR ALREADY WROTE (F154 A) — what `gov close` runs the moment it
 * has opened the governance pull request.
 *
 * `gov rules propose` writes the policy change whole before the pull request exists: rows, version, snapshot,
 * stamps and changelog entry. The only thing missing is the number. This writes it — the deterministic writers over
 * the working tree against the merge-base with the default branch, no model — and returns what changed, so the
 * caller commits it as the author. Nothing is written when `policies/` is untouched against the default branch, or
 * when `gov rules propose` never ran on the branch (no changelog entry of its own for the branch's version): the
 * policy check then names that fix, and close does not half-do it.
 *
 * Pure over its injected git and tree.
 */
import type { GitRead } from "../../cli/policy-gate-io.js";
import { gitTree, type TreeWriter } from "../policy-pr/tree.js";
import { defaultRef } from "../checks/ruleset-io.js";
import { changelogEntry, POLICY_PR_PATHS, readVersion } from "../policy-pr/gate.js";
import { finishPolicyChange } from "./write-result.js";

export interface NumberPrInput {
  readonly home: string;
  readonly defaultBranch: string;
  readonly pr: number;
  /** YYYY-MM-DD, UTC — the day of the commit that will carry the number (the gate's "today", Q66 A). */
  readonly today: string;
  readonly author: string;
}

export function numberPolicyPr(git: GitRead, head: TreeWriter, i: NumberPrInput): { readonly wrote: readonly string[] } | { readonly error: string } {
  const ref = defaultRef(git, i.home, i.defaultBranch);
  const mb = git(i.home, ["merge-base", "HEAD", ref])?.trim();
  if (!mb) return { error: `the merge-base with ${ref} could not be read` };
  const base = gitTree(git, i.home, mb);
  const version = readVersion(head);
  const log = head.read(POLICY_PR_PATHS.changelog), baseLog = base.read(POLICY_PR_PATHS.changelog);
  const own = log !== null && changelogEntry(log, version) !== null && (baseLog === null || changelogEntry(baseLog, version) === null);
  if (!own) return { wrote: [] };
  const r = finishPolicyChange({ base, head, pr: i.pr, today: i.today, author: i.author });
  if (!r.ok) return { error: r.lines.map((l) => l.trim()).join(" ") };
  return { wrote: r.wrote };
}

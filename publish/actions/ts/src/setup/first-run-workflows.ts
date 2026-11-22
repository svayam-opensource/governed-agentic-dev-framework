// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * THE CHECKS ARE THERE FROM THE FIRST COMMIT (F136 G2, ruling Q42 C, 2026-11-22).
 *
 *   gov setup <org>/<repo>  ─► seed, configure, compile ─► + .github/workflows/approver-check.yml
 *                                                         + .github/workflows/gov-checks.yml
 *                           ─► THE SETUP COMMIT (SETUP_COMMIT_SUBJECT) ─► first push
 *                           ─► hard posture only: `gov repo protect apply` (soft: nothing — spec §11.1)
 *
 * Every new organization, on every plan and either posture, gets the approval check and the rules' checks in the
 * one commit setup makes, so its first pull request — the practice change — shows a check waiting for someone
 * else's approval. In the SETUP commit and not a later push: a workflow added by a direct push to the default branch
 * would be a commit no pull request carried, and the GOV-FRM-040 check (landed-by-pr) would open a violation on
 * day one. That check exempts exactly this commit — `isSetupCommit` in rules/checks/gh-actions.ts.
 *
 * Rendered exactly as `gov repo protect apply` writes the approver check and `gov check install` renders gov-checks —
 * the same template, the same renderer — but from the WORKING TREE: nothing is on any branch yet.
 */
import * as path from "node:path";
import { WORKFLOW_DEST, WORKFLOW_TEMPLATE } from "../maintain/repo-protect.js";
import { DEFAULT_RUNNER, runnerFor, withRunsOn, type RunnerChoice } from "../config/ci-runner.js";
import { loadCheckRuleSet } from "../rules/checks/ruleset-io.js";
import { treeAsGit, type TreeReader } from "../rules/policy-pr/tree.js";
import { renderForRepo, withInstalledPin, type CheckVerbConfig } from "../cli/check-verb.js";
import { SETUP_COMMIT_SUBJECT } from "../rules/checks/gh-actions.js";
import type { PostureChoice } from "../config/governance.js";

export { SETUP_COMMIT_SUBJECT };

export interface FirstRunWorkflow {
  /** Repo-relative, posix. */
  readonly path: string;
  readonly text: string;
}

export type FirstRunWorkflows =
  | { readonly ok: true; readonly files: readonly FirstRunWorkflow[] }
  | { readonly ok: false; readonly reason: string };

/** The two workflows for a new governance repo, from its working tree. Pure over `tree`. */
export function firstRunWorkflows(tree: TreeReader, cfg: CheckVerbConfig): FirstRunWorkflows {
  const shipped = tree.read(WORKFLOW_TEMPLATE.split(path.sep).join("/"));
  if (shipped === null) return { ok: false, reason: `the framework's approver-check workflow is not in the new repository (${WORKFLOW_TEMPLATE})` };
  const runner: RunnerChoice = cfg.runner ?? DEFAULT_RUNNER;
  if (runner.problem) return { ok: false, reason: `policies/governance.yaml ${runner.problem}` };
  const approver: FirstRunWorkflow = { path: WORKFLOW_DEST, text: withRunsOn(shipped, runnerFor(runner, null)) };

  // The rules as they are in the working tree — the seeded, token-swept stores the setup commit will carry.
  const loaded = loadCheckRuleSet(treeAsGit(tree), cfg.home, "WORKTREE");
  const rendered = renderForRepo(true, loaded, withInstalledPin(cfg, null));
  if (!rendered.ok) return { ok: false, reason: rendered.reason };
  return { ok: true, files: [approver, ...rendered.files.map((f) => ({ path: f.path, text: f.text }))] };
}

/** What first-run setup did about branch protection, after the setup commit. */
export type FirstRunProtection = "soft" | "not-pushed" | "protected" | "not-protected";

/**
 * HARD POSTURE ONLY: protect the default branch once the setup commit — with its workflows — is on it (Q42 C). Soft,
 * or a posture gov does not recognise: nothing (spec §11.1; `gov repo protect` itself refuses an unrecognised one).
 * `protect` is `gov repo protect apply`, which prints its own report — including the plain-words refusal and the
 * three ways forward when the platform cannot protect the repository. A refusal never fails setup.
 */
export async function protectAtFirstRun(
  input: { readonly pushed: boolean; readonly posture: PostureChoice },
  protect: () => Promise<number> | number,
  print: (line: string) => void,
): Promise<FirstRunProtection> {
  if (input.posture.posture !== "hard") return "soft";
  if (!input.pushed) {
    print("  Hard posture: the setup commit is not on GitHub yet, so the default branch was not protected.");
    print("  Once it is pushed, run:  gov repo protect apply");
    return "not-pushed";
  }
  print("");
  print("Hard posture — protecting the default branch:");
  if ((await protect()) === 0) return "protected";
  print("  Setup carries on: your governance repository is NOT protected yet. The approval check still runs on every");
  print("  pull request; `gov repo protect apply` installs the protection once one of the ways above is done.");
  return "not-protected";
}

// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * RUNNING THE CHECKS BOUND TO A GOV VERB — the disk side of the `gov.verb` gate (rule model, P3 cutover).
 *
 * FROM THE DEFAULT BRANCH, NEVER THE WORKTREE, and that is the whole reason this module is not three lines of
 * `fs.readFile`. A check that gates `gov close` is read from the branch the developer is standing on if we are
 * careless — and then deleting the rule row on your own branch removes the gate that was meant to hold you, while
 * adding one binds a colleague who never agreed to it. Governance is what the default branch says (GOV-FRM-456);
 * a project branch's edits are proposals with no force (GOV-FRM-086).
 *
 * The mechanism is the one the governance snapshot already uses: the project's worktree and the governance clone
 * are one repository, so `git show <default>:<path>` reads the ratified version from inside the project folder,
 * with no second clone and no network.
 *
 * `git` is injected as one function returning `null` on failure, so every path here is testable without a
 * repository — and so that a git that cannot answer produces a NOTED ABSENCE rather than a silent pass.
 */
import * as path from "node:path";
import type { GateResult, WorkspaceView } from "../rules/verb-gate.js";
import type { GateableVerb } from "../rules/checks/predicates.js";
import { loadRuleStores } from "../rules/model/store-io.js";
import { runBoundChecks } from "../rules/checks/local-gate.js";
import type { Fs } from "../lifecycle/fs-io.js";
import { log } from "../log.js";

export interface GitRead {
  /** `git -C <repo> <args>` → stdout, or null when git could not answer. Never throws. */
  (repo: string, args: readonly string[]): string | null;
}

/**
 * A read-only view of one project's directory, for the predicates to judge.
 *
 * Paths are relative to the project directory and use forward slashes on every platform, because a check's globs
 * are written that way in a policy and a Windows separator would silently match nothing.
 */
export function projectWorkspace(fs: Fs, projectDir: string, over: { branch?: string; projectId?: string } = {}): WorkspaceView {
  const walk = (rel: string): string[] => {
    const out: string[] = [];
    for (const name of fs.readdir(path.join(projectDir, rel))) {
      if (name.startsWith(".")) continue;
      const childRel = rel ? `${rel}/${name}` : name;
      const nested = walk(childRel);
      // `readdir` of a file is empty, so a file costs one failed read and needs no stat — the same trick the
      // knowledge collector uses, and the reason neither needs a new port method.
      if (nested.length) out.push(...nested); else out.push(childRel);
    }
    return out;
  };
  let cached: readonly string[] | null = null;
  return {
    exists: (rel) => fs.pathExists(path.join(projectDir, rel)),
    read: (rel) => fs.readFile(path.join(projectDir, rel)),
    paths: () => (cached ??= walk("")),
    ...(over.branch ? { branch: over.branch } : {}),
    ...(over.projectId ? { projectId: over.projectId } : {}),
  };
}

/**
 * Run every in-force rule's checks bound to `gov.verb · <verb>` against this project, the rows read from `ref`.
 *
 * A workspace with no such binding has no checks, and the verb behaves exactly as it did before any of this
 * existed — which is the property that lets the hardcoded close gate be removed without stranding adopters who
 * never bind one.
 */
export function policyGate(
  deps: { git: GitRead; fs: Fs },
  input: { repo: string; ref: string; projectDir: string; branch?: string; projectId?: string },
  verb: GateableVerb,
): GateResult {
  const loaded = loadRuleStores(deps.git, input.repo, input.ref);
  const result = runBoundChecks(
    loaded.ok ? loaded.set : null,
    { resource: "gov.verb", event: verb },
    { workspace: projectWorkspace(deps.fs, input.projectDir, input), ...(input.branch ? { branch: input.branch } : {}) },
    (rel) => deps.git(input.repo, ["show", `${input.ref}:${rel}`]),
  );
  log("info", "policy gate evaluated", "gov-work:cli:policy-gate-io", "policyGate", {
    verb, ref: input.ref, loaded: loaded.ok, failures: result.failures.length, warnings: result.warnings.length,
  });
  return result;
}

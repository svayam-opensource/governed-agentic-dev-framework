// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * READING THE ORGANIZATION'S VERB CHECKS — the disk side of {@link ../rules/verb-gate.js}.
 *
 * FROM THE DEFAULT BRANCH, NEVER THE WORKTREE, and that is the whole reason this module is not three lines of
 * `fs.readFile`. A check that gates `gov close` is read from the branch the developer is standing on if we are
 * careless — and then deleting the clause on your own branch removes the gate that was meant to hold you, while
 * adding one binds a colleague who never agreed to it. Governance is what the default branch says (POL-086a);
 * a project branch's edits are proposals with no force (POL-086b).
 *
 * The mechanism is the one the governance snapshot already uses: the project's worktree and the governance clone
 * are one repository, so `git show <default>:<path>` reads the ratified version from inside the project folder,
 * with no second clone and no network.
 *
 * `git` is injected as one function returning `null` on failure, so every path here is testable without a
 * repository — and so that a git that cannot answer produces a NOTED ABSENCE rather than a silent pass.
 */
import * as path from "node:path";
import { parseCueBlocks } from "../rules/cue-block.js";
import { checksForVerb, gateVerb, type AttachedCheck, type GateResult, type WorkspaceView } from "../rules/verb-gate.js";
import type { GateableVerb } from "../rules/cue-block.js";
import type { Fs } from "../lifecycle/fs-io.js";
import { log } from "../log.js";

/** The two trees policy lives in: the organization's, and the framework's. */
export const POLICY_ROOTS = ["policies", "framework/policies"] as const;

export interface GitRead {
  /** `git -C <repo> <args>` → stdout, or null when git could not answer. Never throws. */
  (repo: string, args: readonly string[]): string | null;
}

/**
 * Every policy document's text at `ref`, keyed by its repo-relative path.
 *
 * `ls-tree` rather than a directory listing: the worktree may hold a policy file that is not committed to the
 * default branch, and that file must not govern anybody.
 */
export function policyDocsAt(git: GitRead, repo: string, ref: string): Record<string, string> {
  const listing = git(repo, ["ls-tree", "-r", "--name-only", ref, "--", ...POLICY_ROOTS]);
  if (listing === null) {
    log("debug", "could not list policy documents at the ref", "gov-work:cli:policy-gate-io", "policyDocsAt", { repo, ref });
    return {};
  }
  const out: Record<string, string> = {};
  for (const rel of listing.split("\n").map((l) => l.trim()).filter((l) => l.endsWith(".md"))) {
    const text = git(repo, ["show", `${ref}:${rel}`]);
    if (text !== null) out[rel] = text;
  }
  return out;
}

/** The checks the organization (and the framework) attached to `verb`, read from `ref`. */
export function verbChecksAt(git: GitRead, repo: string, ref: string, verb: GateableVerb): AttachedCheck[] {
  const checks: AttachedCheck[] = [];
  for (const [doc, text] of Object.entries(policyDocsAt(git, repo, ref))) {
    checks.push(...checksForVerb(parseCueBlocks(doc, text).blocks, verb));
  }
  return checks;
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
 * Run whatever the organization attached to `verb` against this project.
 *
 * A workspace with no such clause has no checks, and the verb behaves exactly as it did before any of this
 * existed — which is the property that lets the hardcoded close gate be removed without stranding adopters who
 * never write a policy.
 */
export function policyGate(
  deps: { git: GitRead; fs: Fs },
  input: { repo: string; ref: string; projectDir: string; branch?: string; projectId?: string },
  verb: GateableVerb,
): GateResult {
  const checks = verbChecksAt(deps.git, input.repo, input.ref, verb);
  if (!checks.length) return { ok: true, failures: [], warnings: [] };
  const result = gateVerb(checks, projectWorkspace(deps.fs, input.projectDir, input));
  log("info", "policy gate evaluated", "gov-work:cli:policy-gate-io", "policyGate", {
    verb, ref: input.ref, checks: checks.length, failures: result.failures.length, warnings: result.warnings.length,
  });
  return result;
}

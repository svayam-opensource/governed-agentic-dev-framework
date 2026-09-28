// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * READING THE CHANGESET AND THE ORGANIZATION'S FILE CHECKS — the disk side of {@link ../rules/diff-check.js}.
 *
 * THE CLAUSES COME FROM THE DEFAULT BRANCH, NEVER FROM THE BRANCH UNDER REVIEW, and that is the whole reason this
 * module exists rather than a `readFile` at the call site. A check that judges a pull request must not be one the
 * pull request can edit: read carelessly from the worktree, deleting the clause on your own branch removes the
 * gate meant to hold you, and adding one binds a colleague who never agreed to it. Governance is what the default
 * branch says (POL-086a); a project branch's edits are proposals with no force (POL-086b). The same rule covers
 * the document a check REFERS to — `list=policies/approved-technologies.md` is read from the ratified branch too,
 * or a pull request could approve its own dependency in the same commit that adds it.
 *
 * The mechanism is `src/cli/policy-gate-io.ts`'s, and `policyDocsAt` is imported from there rather than copied:
 * two functions that both decide where policy comes from is two places for that decision to drift.
 *
 * `git` is injected as one function returning `null` on failure, so every path here is testable without a
 * repository — and so that a git that cannot answer produces a NOTED ABSENCE rather than a silent pass.
 */
import { parseCueBlocks } from "../rules/cue-block.js";
import { checksForFiles, runDiffChecks, selectFileChecks, standaloneChecks, type ChangedFile, type ChangeStatus } from "../rules/diff-check.js";
import type { AttachedCheck, GateResult } from "../rules/verb-gate.js";
import { policyDocsAt, type GitRead } from "./policy-gate-io.js";
import { log } from "../log.js";

/** Where a changeset begins and ends, and which ref the RULES are read from. */
export interface DiffScope {
  /** The repository the change and the policy both live in (the gov workspace clone). */
  readonly repo: string;
  /** The ratified ref the clauses and any `list=` document are read from — the default branch, never HEAD. */
  readonly ref: string;
  /** The comparison point, e.g. the merge-base with the default branch. */
  readonly base: string;
  /** The end of the change, e.g. `HEAD`. */
  readonly head: string;
}

/** git's `--name-status` letters, as the changeset spells them. */
function statusOf(letter: string): ChangeStatus | null {
  if (letter.startsWith("A")) return "added";
  if (letter.startsWith("M") || letter.startsWith("T")) return "modified";
  if (letter.startsWith("D")) return "deleted";
  return null;
}

/**
 * The changed files between `base` and `head`, each with the lines it ADDED and its text at `head`.
 *
 * A RENAME BECOMES TWO ENTRIES — the old path deleted, the new path added. git reports it as one `R100\told\tnew`,
 * and collapsing it to a single "modified new path" would hide the old path from `path-scope`: moving a file out
 * of your writable scope is a write to somewhere you may not write, and it would have gone unreported.
 *
 * `-U0` for the added lines, so the `+` lines are the lines the change actually added and not three lines of
 * surrounding context that somebody else wrote — the distinction `content-forbidden` depends on.
 */
export function changedFiles(git: GitRead, scope: DiffScope): ChangedFile[] {
  const listing = git(scope.repo, ["diff", "--name-status", scope.base, scope.head]);
  if (listing === null) {
    log("debug", "could not read the changeset", "gov-work:cli:diff-check-io", "changedFiles", scope);
    return [];
  }

  const entries: { path: string; status: ChangeStatus }[] = [];
  for (const line of listing.split("\n").map((l) => l.trimEnd()).filter(Boolean)) {
    const [letter, ...rest] = line.split("\t");
    if (!letter || !rest.length) continue;
    if (letter.startsWith("R") || letter.startsWith("C")) {
      const [from, to] = rest;
      if (from && letter.startsWith("R")) entries.push({ path: from, status: "deleted" });
      if (to) entries.push({ path: to, status: "added" });
      continue;
    }
    const status = statusOf(letter);
    // An unrecognised status letter (`U`, an unmerged path) is logged, not guessed at: judging a conflicted
    // file's "added lines" would report the conflict markers as somebody's change.
    if (!status) { log("debug", "unrecognised diff status", "gov-work:cli:diff-check-io", "changedFiles", { line }); continue; }
    entries.push({ path: rest[0]!, status });
  }

  return entries.map(({ path, status }) => {
    const added = status === "deleted"
      ? []
      : (git(scope.repo, ["diff", "-U0", scope.base, scope.head, "--", path]) ?? "")
        .split("\n")
        .filter((l) => l.startsWith("+") && !l.startsWith("+++"))
        .map((l) => l.slice(1));
    return {
      path,
      status,
      addedLines: added,
      text: status === "deleted" ? null : git(scope.repo, ["show", `${scope.head}:${path}`]),
    };
  });
}

/**
 * The file-triggered checks the organization (and the framework) attached to these paths, read from `ref`.
 *
 * BOTH FORMS a check is written in: the tail of a stored cue block, and a `gov:check` standing on its own under a
 * clause. The second is what the seeded policy's POL-203 (the SPDX header, `on_miss=fail`) uses — §6.3 says a rule
 * a machine can see in a diff should be *check only, no cue* — and reading only the first form would have left the
 * starter policy's most emphatic clause unenforced while this module claimed to have fixed exactly that.
 */
export function fileChecksAt(git: GitRead, repo: string, ref: string, changed: readonly ChangedFile[]): AttachedCheck[] {
  const checks: AttachedCheck[] = [];
  for (const [doc, text] of Object.entries(policyDocsAt(git, repo, ref))) {
    checks.push(...checksForFiles(parseCueBlocks(doc, text).blocks, changed));
    checks.push(...selectFileChecks(standaloneChecks(doc, text), changed));
  }
  return checks;
}

/**
 * Run every file-triggered check the ratified policy carries against `base…head`.
 *
 * A workspace whose policy has no such check reports nothing — the property that lets this be added to
 * `gov validate` without failing the pull requests of adopters who have not written a clause yet.
 */
export function policyChecks(deps: { git: GitRead }, scope: DiffScope & { branch?: string }): GateResult {
  const changed = changedFiles(deps.git, scope);
  if (!changed.length) return { ok: true, failures: [], warnings: [] };
  const checks = fileChecksAt(deps.git, scope.repo, scope.ref, changed);
  if (!checks.length) return { ok: true, failures: [], warnings: [] };

  const result = runDiffChecks(
    checks,
    changed,
    // The referenced document, from the RATIFIED ref — see the module note. `git show` and not the worktree.
    (rel) => deps.git(scope.repo, ["show", `${scope.ref}:${rel}`]),
    scope.branch === undefined ? {} : { branch: scope.branch },
  );
  log("info", "policy file checks evaluated", "gov-work:cli:diff-check-io", "policyChecks", {
    ref: scope.ref, base: scope.base, head: scope.head, changed: changed.length, checks: checks.length,
    failures: result.failures.length, warnings: result.warnings.length,
  });
  return result;
}

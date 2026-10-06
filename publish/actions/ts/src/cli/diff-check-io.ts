// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * READING THE CHANGESET, AND RUNNING THE CHANGESET CHECKS `gov validate` PREVIEWS — the disk side of
 * {@link ../rules/diff-check.js}.
 *
 * THE RULES COME FROM THE DEFAULT BRANCH, NEVER FROM THE BRANCH UNDER REVIEW, and that is the whole reason this
 * module exists rather than a `readFile` at the call site. A check that judges a pull request must not be one the
 * pull request can edit: read carelessly from the worktree, deleting the clause on your own branch removes the
 * gate meant to hold you, and adding one binds a colleague who never agreed to it. Governance is what the default
 * branch says (GOV-FRM-456); a project branch's edits are proposals with no force (GOV-FRM-086). The same rule covers
 * the document a check REFERS to — `list=policies/approved-technologies.md` is read from the ratified branch too,
 * or a pull request could approve its own dependency in the same commit that adds it.
 *
 * The rows are read by `loadRuleStores` at the ratified ref, and run through the one check runner
 * ({@link ../rules/checks/local-gate.js}) — the same code `gov check run` uses on the pull request itself.
 *
 * `git` is injected as one function returning `null` on failure, so every path here is testable without a
 * repository — and so that a git that cannot answer produces a NOTED ABSENCE rather than a silent pass.
 */
import type { ChangedFile, ChangeStatus } from "../rules/diff-check.js";
import type { GateResult } from "../rules/verb-gate.js";
import { CHECK_KINDS } from "../rules/checks/predicates.js";
import { loadRuleStores } from "../rules/model/store-io.js";
import { runBoundChecks } from "../rules/checks/local-gate.js";
import type { GitRead } from "./policy-gate-io.js";
import { log } from "../log.js";

/** Where a changeset begins and ends, and which ref the RULES are read from. */
export interface DiffScope {
  /** The repository the change and the policy both live in (the gov workspace clone). */
  readonly repo: string;
  /** The ratified ref the rules and any `list=` document are read from — the default branch, never HEAD. */
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

/** The predicates a changeset can be judged by locally — the `gov-builtin/<kind>` actions. */
const PREDICATE_ACTIONS = new Set(CHECK_KINDS.map((k) => `gov-builtin/${k}`));

/**
 * Run the changeset predicates the ratified rules bind to `vcs.gov-repo · pull_request` against `base…head` — the
 * checks this change will meet when it is a pull request, previewed. Only the predicates: approvals, the policy-PR
 * gate and other actions need the pull request itself, and `gov check run` judges those there.
 *
 * A workspace whose rules bind no such check reports nothing — the property that lets this sit in `gov validate`
 * without failing the pull requests of adopters who have not written a rule yet.
 */
export function policyChecks(deps: { git: GitRead }, scope: DiffScope & { branch?: string }): GateResult {
  const changed = changedFiles(deps.git, scope);
  if (!changed.length) return { ok: true, failures: [], warnings: [] };
  const loaded = loadRuleStores(deps.git, scope.repo, scope.ref);
  const result = runBoundChecks(
    loaded.ok ? loaded.set : null,
    { resource: "vcs.gov-repo", event: "pull_request" },
    { changed, ...(scope.branch === undefined ? {} : { branch: scope.branch }) },
    // The referenced document, from the RATIFIED ref — see the module note. `git show` and not the worktree.
    (rel) => deps.git(scope.repo, ["show", `${scope.ref}:${rel}`]),
    { action: (a) => PREDICATE_ACTIONS.has(a) },
  );
  log("info", "policy file checks evaluated", "gov-work:cli:diff-check-io", "policyChecks", {
    ref: scope.ref, base: scope.base, head: scope.head, changed: changed.length, loaded: loaded.ok,
    failures: result.failures.length, warnings: result.warnings.length,
  });
  return result;
}

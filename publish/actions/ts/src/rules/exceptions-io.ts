// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * THE APPROVED EXCEPTIONS, READ AT THE DEFAULT BRANCH — the disk side of {@link ./exceptions.js} (spec §10;
 * GOV-FRM-464, GOV-FRM-465).
 *
 * AT A REF, NEVER FROM THE WORKTREE, for the reason store-io.ts gives for the rules: an exception file written on a
 * project branch is a REQUEST. Only once its pull request is merged by the domain's representative does it permit
 * anything (GOV-FRM-016), and "merged" is "on the default branch". Same mechanism as store-io and policy-gate-io:
 * `git ls-tree` for what exists, `git show <ref>:<path>` to read it, git injected.
 *
 * Read BESIDE the rule set, not into it: `loadRuleStores`' return shape is a contract other workstreams consume.
 * A caller that loads the set with `loadRuleStores(git, repo, ref)` calls `loadExceptions(git, repo, ref, set)`
 * with the same ref, and hands `exceptions` to `renderResidentBlock(set, { exceptions, today, project })`.
 *
 * THREE ANSWERS, KEPT APART, as in store-io:
 *   no exceptions folder     → none. Most organizations have none; that is a state, not a fault.
 *   an exception that is bad → left out, WITH the reason in `problems` — a framework or C01 rule named, a field
 *                              missing, an unreadable date. The caller reports them; nothing bad is ever rendered.
 *   gov could not tell       → `ok: false`. Never read as "no exceptions": a broken checkout would silently
 *                              withdraw every permission the organization granted, and the agent would stop for
 *                              work already allowed.
 */
import type { GitRead } from "../cli/policy-gate-io.js";
import { log } from "../log.js";
import { parseException, type Exception, type ExceptionProblem, type ExceptionRules } from "./exceptions.js";

/** Where approved exceptions live in the governance repo, one folder per domain (spec §10.2). */
export const EXCEPTIONS_DIR = "policies/exceptions";

/** Files in the folder that are not exceptions: its own explanation, and a copied form not yet filled in. */
const NOT_AN_EXCEPTION = /(^|\/)(README|TEMPLATE)\.md$/i;

export type ExceptionsLoad =
  | { readonly ok: true; readonly exceptions: readonly Exception[]; readonly problems: readonly ExceptionProblem[] }
  | { readonly ok: false; readonly reason: string };

/** Every exception at `ref`, judged against `rules` (the stores read at the same ref). */
export function loadExceptions(git: GitRead, repo: string, ref: string, rules: ExceptionRules): ExceptionsLoad {
  const listing = git(repo, ["ls-tree", "-r", "--name-only", ref, "--", EXCEPTIONS_DIR]);
  if (listing === null) return refuse(`could not list ${EXCEPTIONS_DIR}/ at ${ref} (git did not answer)`, ref);
  const files = listing.split("\n").map((l) => l.trim()).filter((l) => l.endsWith(".md") && !NOT_AN_EXCEPTION.test(l)).sort();

  const exceptions: Exception[] = [];
  const problems: ExceptionProblem[] = [];
  for (const rel of files) {
    const text = git(repo, ["show", `${ref}:${rel}`]);
    if (text === null) return refuse(`${rel} is at ${ref} but git could not read it`, ref);
    const r = parseException({ path: rel, text }, rules);
    if (r.exception) exceptions.push(r.exception);
    if (r.problem) problems.push(r.problem);
  }
  log("debug", "exceptions loaded", "gov-work:rules:exceptions-io", "loadExceptions", {
    ref, files: files.length, exceptions: exceptions.length, problems: problems.length,
  });
  return { ok: true, exceptions, problems };
}

function refuse(reason: string, ref: string): ExceptionsLoad {
  log("info", "exceptions could not be read — reported as cannot-tell", "gov-work:rules:exceptions-io", "loadExceptions", { ref, reason });
  return { ok: false, reason };
}

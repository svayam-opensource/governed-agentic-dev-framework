// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * `gov-builtin/rules-propose` — ON A POLICY PULL REQUEST, A CHECK AND NOTHING MORE (framework specification §9.3;
 * Policy Owner ruling F154 A, 2026-11-24).
 *
 * Bound to `vcs.gov-repo · pull_request(base=default)`. It reads the same gate `gov rules propose` satisfies and
 * says what to run, where the author runs it:
 *
 *   policies/ untouched ................................................. pass
 *   stale — rows behind their text (`sha`) or a section added or changed that the changelog does not list as
 *   reviewed (`unreviewed`) ............................................. miss: run gov rules propose (it reads them)
 *   nothing stale, but the version, snapshot, stamps or changelog — or the entry's pull request number — missing
 *                                                                         miss: run gov rules propose (no model asked)
 *   otherwise ............................................................ pass (the gate, GOV-FRM-467, judges the rest)
 *
 * IT NEVER WRITES. It used to: with the organization's model allowed in CI it proposed and committed rows to the
 * pull request's branch, and with nothing stale it committed the version, snapshot, stamps and changelog itself.
 * A commit pushed by a bot or App holds every workflow of a PRIVATE repository on that commit at "waiting for
 * approval to run" (action_required) — the approver check and the gov checks never ran there, and a new adopter
 * saw that instead of the red stop that names who must approve (F154, observed in the timed journey). So the
 * author writes everything, in their own commit: `gov rules propose` before the pull request opens, and the
 * pull request's number when it is known (`gov close` writes it as it opens the pull request).
 *
 * No model, no network, no forge write; reads git only.
 */
import type { GitRead } from "./policy-gate-io.js";
import type { BuiltinOutcome } from "../rules/checks/builtin.js";
import { judgePolicyPr } from "../rules/policy-pr/gate.js";
import { policyPrFromEvent } from "./check-verb.js";

export interface ProposeCiDeps {
  readonly git: GitRead;
  /** The governance repository's checkout. */
  readonly repoDir: string;
}

const cannot = (f: string[]): BuiltinOutcome => ({ verdict: "cannot-tell", findings: f });
const miss = (f: string[]): BuiltinOutcome => ({ verdict: "miss", findings: f });

/** The gate's findings that mean the model must read something: rows behind their text, or prose nobody reviewed. */
export const STALE: ReadonlySet<string> = new Set(["sha", "unreviewed"]);
/** The gate's findings `gov rules propose` writes without a model: the paperwork around the rows. */
export const PAPERWORK: ReadonlySet<string> = new Set(["version", "changelog", "snapshot", "stamp"]);

/** Why the check does not do it itself — said every time it stops a pull request, so nobody waits for a bot. */
export const NO_CI_WRITE =
  "gov does not write to a pull request: a commit pushed by a bot holds every workflow of a private repository at "
  + "\"waiting for approval to run\". The author writes it, in their own commit";

/** The fix, for the pull request numbered `pr`. */
export function localFix(pr: number, model: boolean): string {
  return `run \`gov rules propose\` on this branch${model ? " (it reads the changed sections with your organization's model and asks what it cannot settle)" : " (no model is asked: the rows are settled)"}, `
    + `commit what it writes and push — it finds this pull request (#${pr}) itself, or pass \`--pr ${pr}\`. ${NO_CI_WRITE}.`;
}

export async function proposeOnPullRequest(tag: string, eventName: string, event: unknown, deps: ProposeCiDeps): Promise<BuiltinOutcome> {
  const input = policyPrFromEvent(deps.git, deps.repoDir, eventName, event);
  if (!input) return cannot([`${tag}: this is not a pull request gov can read (its base and head could not be established), so nothing was checked.`]);
  const judged = judgePolicyPr(input);
  if (judged.verdict === "cannot-tell") return cannot(judged.findings.map((f) => `${tag}: ${f.message}`));
  if (!judged.touched) return { verdict: "pass", findings: [] };

  const stale = judged.findings.filter((f) => STALE.has(f.check)).map((f) => `${tag}: ${f.message}`);
  if (stale.length) return miss([...stale, `${tag}: ${localFix(input.pr, true)}`]);
  const paperwork = judged.findings.filter((f) => PAPERWORK.has(f.check)).map((f) => `${tag}: ${f.message}`);
  if (paperwork.length) return miss([...paperwork, `${tag}: ${localFix(input.pr, false)}`]);
  return { verdict: "pass", findings: [] };
}

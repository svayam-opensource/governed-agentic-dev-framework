// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * THE ORG'S COPY OF A WORKFLOW GOV INSTALLED FOLLOWS ITS RUNNER CHOICE (Policy Owner ruling, 2026-10-17).
 *
 * A workflow gov seeds into an organization's repository (`gov-validate.yml`, MANIFEST mode seed-once) is the
 * organization's from then on, and gov never rewrites it (GOV-FRM-445) — with ONE exception the Policy Owner ruled:
 * when the organization has set `ci.runs_on` in policies/governance.yaml, `gov upgrade` and `gov check install` set
 * the file's job-level `runs-on:` lines to that runner, and report each line they changed. Every other byte stays the
 * organization's. When `ci.runs_on` is absent the file is never touched, and a workflow gov did not install (an org's
 * own `validate.yml`) is never touched at all.
 *
 * Pure but for the injected read and write.
 */
import * as path from "node:path";
import { runsOnEdits, runsOnYaml, withRunsOn, type RunnerChoice } from "../config/ci-runner.js";
import { GOVERNANCE_PATH } from "../config/governance.js";

/**
 * The workflows gov installs into an organization's repository and then hands over: the MANIFEST's `.github/workflows/`
 * rows (a test holds the two equal). gov's own generated workflows (gov-checks.yml, approver-check.yml) are not here —
 * they are re-rendered whole, with the runner, by `gov check install`, `gov repo protect apply` and `gov upgrade`.
 */
export const GOV_SEEDED_WORKFLOWS: readonly string[] = [".github/workflows/gov-validate.yml"];

export interface WorkflowIo {
  readonly read: (abs: string) => string | null;
  readonly write: (abs: string, text: string) => void;
}

/**
 * Set the runs-on lines of the gov-installed workflows in `repoDir` to the organization's runner. `apply: false` lists
 * what it would change and writes nothing. Returns one line per changed `runs-on:` line, and the files changed.
 */
export function syncSeededWorkflowRunners(repoDir: string, runner: RunnerChoice, io: WorkflowIo, apply: boolean): { lines: string[]; changed: string[] } {
  const lines: string[] = [];
  const changed: string[] = [];
  if (!runner.chosen && !runner.problem) return { lines, changed };   // absent: never touched
  for (const rel of GOV_SEEDED_WORKFLOWS) {
    const abs = path.join(repoDir, ...rel.split("/"));
    const text = io.read(abs);
    if (text === null) continue;
    if (runner.problem) {
      lines.push(`  ! ${rel}: its runs-on left as it is — ${GOVERNANCE_PATH} ${runner.problem}`);
      continue;
    }
    const value = runsOnYaml(runner.runsOn);
    const edits = runsOnEdits(text, value);
    if (!edits.length) continue;
    if (apply) io.write(abs, withRunsOn(text, value));
    changed.push(rel);
    for (const e of edits) lines.push(`  ${apply ? "" : "~ update   "}${rel}:${e.line}  runs-on: ${e.was} → ${e.now}   (ci.runs_on in ${GOVERNANCE_PATH})`);
  }
  return { lines, changed };
}

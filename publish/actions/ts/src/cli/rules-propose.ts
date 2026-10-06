// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * `gov rules propose [--all] [--pr <n>]` — the terminal trigger (rule-model-design.md Q16–Q18; P3 wave 2).
 *
 * Runs on the branch being edited: the working tree is the head, the default branch (as this branch left it — the
 * merge-base) is the base. The questions are asked at the terminal; an empty answer stops the run with nothing
 * written. The model is the one the organization approved in `policies/governance.yaml` ON THE DEFAULT BRANCH.
 *
 * Pure over its injected ports; main.ts wires them (readline, run-process, fetch).
 */
import type { CommandResult } from "./dispatch.js";
import type { GitRead } from "./policy-gate-io.js";
import { gitTree, type TreeWriter } from "../rules/policy-pr/tree.js";
import { defaultRef } from "../rules/checks/ruleset-io.js";
import type { InterviewChannel } from "../rules/propose/interview.js";
import type { ModelPort } from "../rules/propose/model-port.js";
import { applyPropose, openLines } from "../rules/propose/apply.js";
import { GOVERNANCE_PATH, readModelSettings, type ModelSettings } from "../rules/propose/model-settings.js";

export interface ProposeVerbDeps {
  readonly git: GitRead;
  /** The governance repository's working tree, as a tree. */
  readonly head: TreeWriter;
  readonly channel: InterviewChannel;
  /** The model for these settings — resolved only if a section actually needs reading. */
  readonly model: (settings: ModelSettings) => ModelPort;
  /** `gh pr view` for the current branch, when no `--pr` was given. */
  readonly currentPr?: () => number | undefined;
}

export interface ProposeVerbInput {
  readonly home: string;
  readonly defaultBranch: string;
  readonly all: boolean;
  readonly pr?: number;
  readonly today: string;
  readonly author: string;
}

export const PROPOSE_USAGE = "rules propose [--all] [--pr <n>]";

/** The org's model settings, from the default branch. */
export function settingsAt(git: GitRead, home: string, ref: string): ModelSettings {
  return readModelSettings(git(home, ["show", `${ref}:${GOVERNANCE_PATH}`]));
}

export async function rulesPropose(deps: ProposeVerbDeps, input: ProposeVerbInput): Promise<CommandResult> {
  const ref = defaultRef(deps.git, input.home, input.defaultBranch);
  const mb = deps.git(input.home, ["merge-base", "HEAD", ref])?.trim() || ref;
  const base = gitTree(deps.git, input.home, mb);
  const pr = input.pr ?? deps.currentPr?.();
  const head = [`gov rules propose — the working tree against ${ref}${mb !== ref ? ` (merge-base ${mb.slice(0, 7)})` : ""}`];

  const r = await applyPropose({
    base, head: deps.head, model: deps.model(settingsAt(deps.git, input.home, ref)), channel: deps.channel,
    today: input.today, author: input.author, all: input.all, ...(pr !== undefined ? { pr } : {}),
  });
  if (r.status === "blocked") {
    return { code: 1, lines: [...head, "", "Stopped: these questions have no answer yet. Nothing was written.", ...openLines(r.open), "",
      "Run `gov rules propose` again and answer them."] };
  }
  if (r.status === "failed") return { code: 1, lines: [...head, "", ...r.lines.map((l) => (l.startsWith(" ") ? l : `  ${l}`)), "", "Nothing more was written."] };
  const c = r.counts;
  return {
    code: 0,
    lines: [
      ...head, "",
      `  ${r.sections} section(s) read · added ${c.added} · revised ${c.revised} · retired ${c.retired} · kept ${c.kept}`,
      `  version bump: ${r.bump}`,
      "  open questions: none",
      ...r.lines,
      "",
      r.wrote.length ? "Review the changes, commit them with the prose, and have the pull request approved." : "Nothing to change — the rules already match the prose.",
    ],
  };
}

// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * PROPOSE, ON TWO TREES — what both triggers run (rule-model-design.md P1 "Propose trigger"; P3 wave 2).
 *
 *   base  the default branch as this change branched from it (read only)
 *   head  the branch being edited (a worktree on disk; written)
 *
 * The STORES ARE READ FROM THE HEAD: propose runs on the branch being edited, so a section an earlier run already
 * settled carries its new sha there and is not asked about again (one run per section sha, Q16). Ids are issued
 * past every id either tree has ever held, so a branch can never reissue a number the default branch used.
 *
 * Then the result is written ({@link writeProposal}) and the pull request finished ({@link finishPolicyChange}).
 * Blocked or failed → NOTHING is written.
 */
import { treeAsGit, type TreeReader, type TreeWriter } from "../policy-pr/tree.js";
import { nextVersion, POLICY_PR_PATHS, readVersion } from "../policy-pr/gate.js";
import { loadCheckRuleSet } from "../checks/ruleset-io.js";
import { parseRuleStore, type RuleRow } from "../model/rule-row.js";
import { createIdIssuer, everIssuedIds } from "../model/store-io.js";
import type { ModelPort } from "./model-port.js";
import type { InterviewChannel } from "./interview.js";
import { ProposeError } from "./parse.js";
import { runPropose, type OpenSection, type PolicyDoc, type RuleChange } from "./run.js";
import { ModelRefused } from "./providers/index.js";
import { ModelProviderError } from "./providers/anthropic.js";
import { finishPolicyChange, writeProposal } from "./write-result.js";

export interface ApplyInput {
  readonly base: TreeReader;
  readonly head: TreeWriter;
  readonly model: ModelPort;
  readonly channel: InterviewChannel;
  readonly today: string;
  readonly pr?: number;
  readonly author: string;
  readonly all?: boolean;
}

export type Counts = Readonly<Record<RuleChange, number>>;

export type ApplyResult =
  | { readonly status: "written"; readonly counts: Counts; readonly sections: number; readonly lines: readonly string[]; readonly wrote: readonly string[]; readonly bump: string }
  | { readonly status: "blocked"; readonly open: readonly OpenSection[] }
  | { readonly status: "failed"; readonly lines: readonly string[] };

/** The policy documents: `policies/**.md`, minus the frozen snapshots, the actions and the changelog. */
export function policyDocPaths(tree: TreeReader): string[] | null {
  const files = tree.files(POLICY_PR_PATHS.root);
  if (files === null) return null;
  return files.filter((f) => f.endsWith(".md") && f !== POLICY_PR_PATHS.changelog
    && !f.startsWith(`${POLICY_PR_PATHS.snapshots}/`) && !f.startsWith(`${POLICY_PR_PATHS.actions}/`));
}

function baseRows(base: TreeReader): RuleRow[] {
  const t = base.read(POLICY_PR_PATHS.rules);
  if (t === null) return [];
  try { return parseRuleStore(t); } catch { return []; /* the gate reports an unparseable base store; ids then come from the head alone */ }
}

export async function applyPropose(i: ApplyInput): Promise<ApplyResult> {
  const loaded = loadCheckRuleSet(treeAsGit(i.head), "", "HEAD");
  if (!loaded.ok) return { status: "failed", lines: [`the rule stores on this branch could not be read: ${loaded.reason}`] };
  const set = loaded.set;

  const headDocs = policyDocPaths(i.head), baseDocs = policyDocPaths(i.base);
  if (headDocs === null || baseDocs === null) return { status: "failed", lines: ["policies/ could not be listed"] };
  const docs: PolicyDoc[] = [...new Set([...headDocs, ...baseDocs])].sort().map((doc) => ({ doc, head: i.head.read(doc), base: i.base.read(doc) }));

  const issuer = createIdIssuer(everIssuedIds({ framework: set.framework, org: [...set.org, ...baseRows(i.base)] }));
  const at = { version: nextVersion(readVersion(i.base), "minor"), date: i.today, ...(i.pr !== undefined ? { pr: i.pr } : {}) };

  let r;
  try {
    r = await runPropose({ docs, set, model: i.model, channel: i.channel, issuer, at, ...(i.all ? { all: true } : {}) });
  } catch (e) {
    if (e instanceof ModelRefused) return { status: "failed", lines: e.lines };
    if (e instanceof ModelProviderError || e instanceof ProposeError) return { status: "failed", lines: [`the model could not be used: ${e.message}`] };
    throw e;
  }
  if (r.status === "blocked") return { status: "blocked", open: r.open };
  if (r.status === "failed") {
    return { status: "failed", lines: [...r.problems, ...r.open.map((o) => `${o.doc} §${o.section} did not settle`)] };
  }

  const counts: Record<RuleChange, number> = { added: 0, revised: 0, retired: 0, kept: 0 };
  for (const x of r.changelogDraft.rules) counts[x.change]++;
  const wrote = writeProposal(i.head, r);
  const fin = finishPolicyChange({ base: i.base, head: i.head, today: i.today, author: i.author, ...(i.pr !== undefined ? { pr: i.pr } : {}) });
  const lines = [...wrote.map((w) => `  wrote ${w}`), ...fin.lines];
  const plan = fin.plan;
  if (!fin.ok || !plan) return { status: "failed", lines };
  const bump = plan.required === "none" ? "none" : `${plan.required} (${plan.baseVersion} → ${fin.version})`;
  return { status: "written", counts, sections: r.sections.length, bump, wrote: [...new Set([...wrote, ...fin.wrote])].sort(), lines };
}

/** The open questions, as a person reads them. */
export function openLines(open: readonly OpenSection[]): string[] {
  return open.flatMap((o) => [`  ${o.doc} §${o.section}`, ...o.questions.map((q) => `    ? ${q.text}`)]);
}

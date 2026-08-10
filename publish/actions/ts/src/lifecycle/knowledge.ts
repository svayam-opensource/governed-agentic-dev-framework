// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * `knowledge` (SDD Part C, cmd_knowledge / propose-knowledge.sh) — the org-
 * knowledge proposal lifecycle: a `knowledge-<slug>` branch on the gov repo →
 * PR → archive. Org knowledge is read-only during a project (C01); this is the
 * sanctioned way to change it (branch + review). Pure over Vcs + Pulls.
 */
import type { Vcs } from "./vcs.js";
import type { Pulls } from "./pulls.js";
import { archiveBranch } from "./merge.js";

export interface KnowledgeConfig {
  readonly defaultBranch: string;
  readonly githubOrg: string;
  readonly workspaceRepo: string;
  readonly remote?: string;
}

export type KnowledgeResult =
  | { readonly ok: true; readonly lines: readonly string[] }
  | { readonly ok: false; readonly code: number; readonly message: string };

/** The branch name for a knowledge proposal. */
export function knowledgeBranch(slug: string): string {
  return `knowledge-${slug}`;
}

/** Create + push a `knowledge-<slug>` proposal branch off the default branch. */
export function proposeKnowledge(vcs: Vcs, config: KnowledgeConfig, home: string, slug: string): KnowledgeResult {
  if (!slug) return { ok: false, code: 2, message: "usage: gov knowledge propose <slug>" };
  const branch = knowledgeBranch(slug);
  const remote = config.remote ?? "origin";
  try {
    vcs.fetch(home, remote, config.defaultBranch);
    vcs.checkout(home, config.defaultBranch);
    vcs.checkoutNew(home, branch);
    vcs.push(home, remote, branch, { setUpstream: true });
    return { ok: true, lines: [`Created knowledge branch '${branch}' (pushed).`, `  edit under knowledge/, then: prj knowledge submit ${slug} "<desc>"`] };
  } catch (e) {
    return { ok: false, code: 1, message: (e as Error).message };
  }
}

/** Open a PR for a `knowledge-<slug>` branch → the default branch. */
export function submitKnowledge(pulls: Pulls, config: KnowledgeConfig, slug: string, description: string): KnowledgeResult {
  if (!slug) return { ok: false, code: 2, message: "usage: gov knowledge submit <slug> [description]" };
  const branch = knowledgeBranch(slug);
  const repo = `${config.githubOrg}/${config.workspaceRepo}`;
  const url = pulls.create(repo, config.defaultBranch, branch, `knowledge: ${slug}`, description || `Org knowledge proposal: ${slug}`);
  return url ? { ok: true, lines: [`Opened knowledge PR: ${url}`] } : { ok: false, code: 1, message: `Could not open a PR for '${branch}'.` };
}

/** Archive a merged `knowledge-<slug>` branch (tag archive/<branch> + delete). */
export function archiveKnowledge(vcs: Vcs, config: KnowledgeConfig, home: string, slug: string): KnowledgeResult {
  if (!slug) return { ok: false, code: 2, message: "usage: gov knowledge archive <slug>" };
  const branch = knowledgeBranch(slug);
  try {
    archiveBranch(vcs, home, branch, config.remote ?? "origin");
    return { ok: true, lines: [`Archived '${branch}' (tag archive/${branch} + deleted).`] };
  } catch (e) {
    return { ok: false, code: 1, message: (e as Error).message };
  }
}

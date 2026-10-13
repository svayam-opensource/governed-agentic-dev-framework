// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * `gov project <name> [--repo r]` — a board is never born without owners (plan 03 L06, spec 03 §7, gadf#182).
 *
 *   pre-seed checks ─► createProject ─► anchor issue (label anchor, assigned to the invoker) ─► on the board
 *        │ fail: fixable messages, NOTHING created      │ any later step fails: report exactly what exists, non-ok
 *        └──────────────────────────────────────────────┴─► each --repo: an item in it, on the board (that is how a
 *                                                           board says which repositories take part — seed reads it)
 *
 * The shape of `ensureStarterProject` (lifecycle/starter-project.ts), which made a board and an issue but no
 * labelled anchor. Through the ports only (lint: no-direct-gh covers src/project) — never `gh`.
 *
 * THE PRE-SEED CONDITIONS — the board contract (framework-specification.md §4.2; `gov seed` enforces the first two
 * through `validateBoard`). gadf#182 cites them by their old policy numbers, which retired with no rule row (Q21), so
 * they are named here. Checked where they are cheap to fix, instead of at seed time:
 *   name          the board has a name                        → non-blank, and makes a project id
 *   linked-item   the board has ≥1 linked issue or PR         → the anchor will be it: the governance repo is readable
 *                                                                and gov knows who to assign it to
 *   repositories  each linked item is in an identifiable repo → every --repo is owner/name (or a name in this org)
 *                                                                and readable
 *   description   the board MAY have a description            → advisory only
 *   scope         an issue MAY mark the project's scope       → the anchor is titled as the scope marker
 */
import type { WorkTrackerPort, ItemRef, ProjectRef } from "../ports/work-tracker.js";
import type { RepoRef, VcsPort } from "../ports/vcs.js";
import { anchorIssueBody, DEFAULT_ANCHOR_LABEL } from "../lifecycle/anchor.js";
import { slugify } from "../lifecycle/identity.js";

export interface ProjectEnv {
  readonly tracker: WorkTrackerPort;
  readonly vcs: VcsPort;
  /** Who owns the board (the org). */
  readonly owner: string;
  /** The governance repo — where the anchor lives. */
  readonly govRepo: RepoRef;
  /** The base `gov seed` declares for code repos; recorded in the anchor so `gov close` can read it back. */
  readonly defaultCodeBranch: string;
}

export interface ProjectRequest {
  readonly name: string;
  /** `owner/name`, a bare name (this org), or a repository URL. */
  readonly repos: readonly string[];
}

export type PreSeedRule = "name" | "linked-item" | "repositories" | "description" | "scope";

export interface PreSeedCheck {
  readonly rule: PreSeedRule;
  readonly ok: boolean;
  /** A MAY: reported, never blocks. */
  readonly advisory?: boolean;
  /** What is wrong and how to fix it (empty when ok and nothing to say). */
  readonly message: string;
}

export interface PreSeed {
  readonly ok: boolean;
  readonly checks: readonly PreSeedCheck[];
  readonly invoker: string | null;
  /** The --repo repositories other than the governance repo, resolved and de-duplicated. */
  readonly codeRepos: readonly RepoRef[];
}

/** What exists on the tracker after a run — the whole of what a report may claim. */
export interface Created {
  readonly board: { readonly ref: ProjectRef; readonly url: string | null } | null;
  readonly anchor: ItemRef | null;
  readonly anchorOnBoard: boolean;
  readonly repoItems: readonly { readonly repo: string; readonly url: string; readonly onBoard: boolean }[];
}

export type ProjectOutcome =
  | { readonly ok: true; readonly created: Created; readonly boardUrl: string; readonly lines: string[] }
  | { readonly ok: false; readonly stage: "pre-seed"; readonly created: Created; readonly lines: string[] }
  | { readonly ok: false; readonly stage: "after-create"; readonly created: Created; readonly lines: string[] };

const NOTHING: Created = { board: null, anchor: null, anchorOnBoard: false, repoItems: [] };
const slug = (r: RepoRef): string => `${r.owner}/${r.name}`;

/** `owner/name`, a bare `name` (in `org`), or a URL ending in `/owner/name[.git]` — else null. */
export function parseRepo(text: string, org: string): RepoRef | null {
  const t = text.trim().replace(/\.git$/, "").replace(/\/+$/, "");
  const url = /^[a-z][a-z0-9+.-]*:\/\/[^/]+\/([^/\s]+)\/([^/\s]+)$/i.exec(t);
  if (url) return { owner: url[1]!, name: url[2]! };
  const NAME = /^[A-Za-z0-9_.-]+$/;
  const parts = t.split("/");
  if (parts.length === 1 && NAME.test(parts[0]!)) return { owner: org, name: parts[0]! };
  if (parts.length === 2 && NAME.test(parts[0]!) && NAME.test(parts[1]!)) return { owner: parts[0]!, name: parts[1]! };
  return null;
}

/** Every pre-seed condition, all at once (one run tells you everything to fix). Reads only. */
export async function preSeedChecks(env: ProjectEnv, req: ProjectRequest): Promise<PreSeed> {
  const checks: PreSeedCheck[] = [];
  const name = req.name.trim();

  // name — a name, and one gov seed can turn into PRJ-<n>-<slug>.
  if (!name) checks.push({ rule: "name", ok: false, message: `the project needs a name — gov project "<name>" (for example gov project "Invoice API v2")` });
  else if (!slugify(name)) checks.push({ rule: "name", ok: false, message: `"${name}" has no letter or digit, so it cannot become a project id — choose a name with at least one letter or digit` });
  else checks.push({ rule: "name", ok: true, message: "" });

  // linked-item — the anchor will be the board's first linked item; it needs a readable governance repo and an assignee.
  const p063: string[] = [];
  const gov = await env.vcs.repo(env.govRepo);
  if (!gov.ok) p063.push(`the governance repo ${slug(env.govRepo)} cannot be read (${gov.reason}) — check org-config.yaml's github_org/workspace_repo and that you can write there`);
  const who = await env.vcs.identity();
  let invoker: string | null = null;
  if (!who.ok) p063.push(`gov cannot tell who you are (${who.reason}) — the anchor is assigned to you; run \`gh auth login\` (\`gov doctor\` says more)`);
  else if (who.value.kind === "bot") p063.push(`${who.value.login} is an automated account — a project is started by a person who decided the work exists (intent stays human, #182); run this signed in as yourself`);
  else invoker = who.value.login;
  checks.push({ rule: "linked-item", ok: p063.length === 0, message: p063.join("\n") });

  // repositories — each --repo an identifiable, readable repository. The governance repo needs none (it always takes part).
  const bad: string[] = [];
  const code: RepoRef[] = [];
  for (const raw of req.repos.map((r) => r.trim()).filter(Boolean)) {
    const ref = parseRepo(raw, env.owner);
    if (!ref) { bad.push(`'${raw}' is not a repository — use owner/name (or a name in ${env.owner})`); continue; }
    if (ref.owner.toLowerCase() === env.govRepo.owner.toLowerCase() && ref.name.toLowerCase() === env.govRepo.name.toLowerCase()) continue;
    if (code.some((c) => slug(c).toLowerCase() === slug(ref).toLowerCase())) continue;
    const r = await env.vcs.repo(ref);
    if (!r.ok) { bad.push(`${slug(ref)} cannot be read (${r.reason}) — check the name, and that you have access`); continue; }
    code.push(ref);
  }
  checks.push({ rule: "repositories", ok: bad.length === 0, message: bad.join("\n") });

  // description / scope — MAYs. The port creates a board with a title only, so a description is the person's to add.
  checks.push({ rule: "description", ok: true, advisory: true, message: "the board will have no description (optional) — `gov seed` warns about it, nothing more" });
  checks.push({ rule: "scope", ok: true, message: "the anchor issue marks the project's scope" });

  return { ok: checks.every((c) => c.ok), checks, invoker, codeRepos: code };
}

function report(c: Created): string[] {
  const out = ["  What exists now:"];
  if (!c.board) { out.push("    nothing"); return out; }
  out.push(`    board    ${c.board.url ?? `${c.board.ref.owner}#${c.board.ref.number}`} (#${c.board.ref.number})`);
  if (c.anchor) out.push(`    anchor   ${c.anchor.url}${c.anchorOnBoard ? "" : " — NOT on the board"}`);
  for (const r of c.repoItems) out.push(`    ${r.repo}  ${r.url}${r.onBoard ? "" : " — NOT on the board"}`);
  return out;
}

/** Create the board, its anchor and each repo's item — or say exactly how far it got. */
export async function createGovProject(env: ProjectEnv, req: ProjectRequest): Promise<ProjectOutcome> {
  const pre = await preSeedChecks(env, req);
  if (!pre.ok || !pre.invoker) {
    const lines = [`Cannot create project "${req.name.trim()}" — nothing was created. Fix these and run it again:`];
    for (const c of pre.checks) if (!c.ok) for (const m of c.message.split("\n")) lines.push(`  ✗ ${c.rule}: ${m}`);
    return { ok: false, stage: "pre-seed", created: NOTHING, lines };
  }
  const name = req.name.trim();
  const invoker = pre.invoker;
  let created: Created = NOTHING;

  const stop = (step: string, reason: string, notDone: readonly string[]): ProjectOutcome => ({
    ok: false, stage: "after-create", created,
    lines: [
      `gov project stopped at: ${step} — ${reason}`,
      ...report(created),
      ...notDone.map((n) => `  not created: ${n}`),
      "  Finish THIS board rather than re-running `gov project`, which would make a second board.",
    ],
  });

  const board = await env.tracker.createProject(env.owner, name);
  if (!board.ok) {
    const lines = [`Could not create the board for "${name}" — ${board.reason}`, "  Nothing was created."];
    return { ok: false, stage: "after-create", created, lines };
  }
  const ref = board.value;
  created = { ...created, board: { ref, url: null } };

  const read = await env.tracker.project(ref);
  if (!read.ok || !read.value.url) {
    return stop("reading the new board back", read.ok ? "the tracker gave no address for it" : read.reason,
      ["the anchor issue", ...pre.codeRepos.map((r) => `the item that puts ${slug(r)} on the board`)]);
  }
  const boardUrl = read.value.url;
  created = { ...created, board: { ref, url: boardUrl } };

  const anchor = await env.tracker.create(env.govRepo, {
    title: `${name}: project scope & anchor`,
    body: anchorIssueBody(ref.number, name, pre.codeRepos.length ? env.defaultCodeBranch : null),
    assignee: invoker,
    labels: [DEFAULT_ANCHOR_LABEL],
  });
  if (!anchor.ok) {
    return stop("creating the anchor issue", anchor.reason,
      ["the anchor issue — the board has no owner and no linked item, so `gov seed` refuses it",
        ...pre.codeRepos.map((r) => `the item that puts ${slug(r)} on the board`)]);
  }
  created = { ...created, anchor: anchor.value };
  const onBoard = await env.tracker.addToProject(ref, anchor.value);
  if (!onBoard.ok) {
    return stop("putting the anchor on the board", onBoard.reason,
      ["the anchor's place on the board (`gov issue` with --board, or re-add it) — it is the project scope marker",
        ...pre.codeRepos.map((r) => `the item that puts ${slug(r)} on the board`)]);
  }
  created = { ...created, anchorOnBoard: true };

  const items: { repo: string; url: string; onBoard: boolean }[] = [];
  for (const [i, repo] of pre.codeRepos.entries()) {
    const rest = pre.codeRepos.slice(i + 1).map((r) => `the item that puts ${slug(r)} on the board`);
    const it = await env.tracker.create(repo, {
      title: `${name}: work in ${repo.name}`,
      body: `This repository takes part in the project on board #${ref.number} — *${name}*. `
        + `Its scope is the anchor issue, ${anchor.value.url}.\n\nCreated by \`gov project\` so \`gov seed\` gives ${repo.name} a project branch.`,
      assignee: invoker,
    });
    if (!it.ok) return stop(`creating the item in ${slug(repo)}`, it.reason, [`the item that puts ${slug(repo)} on the board`, ...rest]);
    items.push({ repo: slug(repo), url: it.value.url, onBoard: false });
    created = { ...created, repoItems: [...items] };
    const add = await env.tracker.addToProject(ref, it.value);
    if (!add.ok) return stop(`putting the ${slug(repo)} item on the board`, add.reason, [`${slug(repo)}'s place on the board`, ...rest]);
    items[items.length - 1] = { ...items[items.length - 1]!, onBoard: true };
    created = { ...created, repoItems: [...items] };
  }

  const advisories = pre.checks.filter((c) => c.advisory && c.message).map((c) => `  · ${c.rule}: ${c.message}`);
  return {
    ok: true, created, boardUrl,
    lines: [
      `Created project "${name}"`,
      `  Board:   ${boardUrl} (#${ref.number})`,
      `  Anchor:  ${anchor.value.url} — labelled ${DEFAULT_ANCHOR_LABEL}, assigned to ${invoker}, on the board`,
      ...items.map((r) => `  Repo:    ${r.repo} takes part — ${r.url}`),
      ...advisories,
      `  Next:    gov seed ${boardUrl}`,
    ],
  };
}

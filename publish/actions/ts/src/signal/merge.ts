// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * `gov signal merge` — one project folds into another (spec 03 §4): every item of the sender's board moves to the
 * receiver's; the sender's linked repositories are named for `gov add-repo` in the receiver's workspace (a repo joins
 * a project by being worked there, not by a board write); then the sender's board closes, and its anchor closes with
 * a pointer. Only the owner of BOTH boards may, and that is checked before anything moves. If any item cannot move,
 * nothing is closed.
 */
import type { ProjectRef } from "../ports/work-tracker.js";
import type { Result } from "../ports/result.js";
import { recordAct, type ActReport } from "./handover.js";
import { anchorOf, boardOf, type SignalEnv } from "./send.js";

export interface MergeDeps {
  /** Does the invoker own this board? (gov's owner test: write access to the project.) */
  readonly isOwner: (p: ProjectRef) => Promise<boolean>;
  /** The repositories linked to a board. */
  readonly repos: (p: ProjectRef) => Promise<Result<string[]>>;
}

export async function mergeProjects(env: SignalEnv, deps: MergeDeps, req: { to: string; title: string; body: string }): Promise<ActReport> {
  const refuse = (m: string): ActReport => ({ ok: false, url: null, lines: [m] });
  const from = boardOf(env.owner, env.project);
  const to = boardOf(env.owner, req.to);
  if (!from) return refuse(`the active project '${env.project}' is not a PRJ-<n>-<slug> id.`);
  if (!to) return refuse(`--to takes a project id like PRJ-119-gov-iam, not '${req.to}'.`);
  if (!req.title.trim()) return refuse("a merge needs a title (--title).");
  if (!(await deps.isOwner(from)) || !(await deps.isOwner(to))) {
    return refuse(`a merge needs the owner of both boards — ${env.login} must own ${env.project} and ${req.to}. Nothing was moved.`);
  }

  const items = await env.tracker.items(from);
  if (!items.ok) return refuse(`could not read ${env.project}'s board: ${items.reason}`);
  const anchor = await anchorOf(env.tracker, from);
  const lines = [`Merge ${env.project} → ${req.to}`];
  const moved: string[] = [];
  let failed = 0;
  for (const it of items.value) {
    if (anchor && it.ref.url === anchor.url) continue; // the anchor stays, closed, as the pointer
    const a = await env.tracker.addToProject(to, it.ref);
    if (a.ok) { moved.push(it.ref.url); lines.push(`  moved ${it.ref.url}`); }
    else { failed++; lines.push(`  ✗ ${it.ref.url}: ${req.to}'s board refused it (${a.reason})`); }
  }

  const fr = await deps.repos(from), tr = await deps.repos(to);
  const missing = fr.ok ? fr.value.filter((u) => !(tr.ok ? tr.value : []).includes(u)) : [];
  if (!fr.ok) lines.push(`  ⚠ ${env.project}'s linked repositories could not be read (${fr.reason}) — check them by hand`);
  for (const u of missing) lines.push(`  in ${req.to}'s workspace: gov add-repo ${u}`);

  if (failed) {
    lines.push(`  ${failed} item(s) did not move — ${env.project}'s board and anchor are left OPEN. Fix and run the merge again (it is safe to repeat).`);
    const rec = await recordAct(env, "merge", { ...req, items: moved }, moved, ["Incomplete: the sender's board was left open."]);
    return { ok: false, url: rec.url, lines: [...lines, ...rec.lines] };
  }

  const rec = await recordAct(env, "merge", { ...req, items: moved }, moved, missing.map((u) => `Repository to add in ${req.to}: ${u}`));
  const pointer = `Merged into ${req.to}${rec.url ? ` (${rec.url})` : ""}.`;
  let ok = !!rec.url;
  if (anchor) {
    const c = await env.tracker.comment(anchor, pointer);
    const cl = c.ok ? await env.tracker.close(anchor) : c;
    lines.push(cl.ok ? `  anchor closed: ${anchor.url}` : `  ✗ anchor not closed: ${cl.ok ? "" : cl.reason}`);
    if (!cl.ok) ok = false;
  } else lines.push(`  ⚠ ${env.project} has no anchor on its board — nothing to close with the pointer`);
  const cp = await env.tracker.closeProject(from, pointer);
  lines.push(cp.ok ? `  ${env.project}'s board closed — "${pointer}"` : `  ✗ ${env.project}'s board could not be closed: ${cp.reason}`);
  if (!cp.ok) ok = false;
  return { ok, url: rec.url, lines: [...lines, ...rec.lines] };
}

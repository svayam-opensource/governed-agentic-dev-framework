// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * `gov signal ask|depends|notice` — sending (spec 03 §4). Through WorkTrackerPort only (the no-direct-gh guard).
 *
 *   1. one issue in the GOV repo: label `gov-signal:<kind>`, the marker in its body, assigned to the sender
 *   2. onto the receiver's board (Status Todo) — a board the sender cannot write is reported, not fatal: the
 *      receiver finds the signal by label + marker (Q5)
 *   3. onto the sender's board (it tracks the answer)
 *   4. depends: the signal BLOCKS the sender's anchor (or each `--items` ref)
 *
 * Who may send (a person, at a terminal, not an agent session) is checked by the caller with `sendGuard` (Q6).
 * handover and merge are acts on whole boards (plan 03 L08) and are not sent here.
 */
import type { WorkTrackerPort, ProjectRef, ItemRef } from "../ports/work-tracker.js";
import type { RepoRef } from "../ports/vcs.js";
import { renderMarker, signalLabel } from "./marker.js";
import type { SignalKind } from "./model.js";

export interface SignalEnv {
  readonly tracker: WorkTrackerPort;
  /** The organization's gov repo — where every signal issue lives. */
  readonly govRepo: RepoRef;
  /** The owner of the project boards (the GitHub organization). */
  readonly owner: string;
  /** Who is acting — the sender, or the receiver acknowledging. */
  readonly login: string;
  /** The active project's id (`PRJ-<n>-<slug>`). */
  readonly project: string;
}

export interface SignalRequest {
  readonly kind: SignalKind;
  readonly to: string;
  readonly title: string;
  readonly body: string;
  readonly items: readonly string[];
}

export interface SendReport { readonly ok: boolean; readonly url: string | null; readonly lines: string[] }

const PROJECT_ID = /^PRJ-(\d+)-[A-Za-z0-9._-]+$/;

/** `PRJ-<n>-<slug>` → its board, or null when it is not a project id. */
export function boardOf(owner: string, projectId: string): ProjectRef | null {
  const m = PROJECT_ID.exec(projectId.trim());
  return m ? { owner, number: Number(m[1]) } : null;
}

/** The project's anchor issue: the item on its board labelled `anchor`. */
export async function anchorOf(tracker: WorkTrackerPort, board: ProjectRef): Promise<ItemRef | null> {
  const r = await tracker.items(board);
  if (!r.ok) return null;
  return r.value.find((i) => i.labels.includes("anchor"))?.ref ?? null;
}

export async function sendSignal(env: SignalEnv, req: SignalRequest): Promise<SendReport> {
  const refuse = (msg: string): SendReport => ({ ok: false, url: null, lines: [msg] });
  if (req.kind === "handover" || req.kind === "merge") return refuse(`gov signal ${req.kind} moves whole boards — it is not sent as a request.`);
  const from = boardOf(env.owner, env.project);
  if (!from) return refuse(`the active project '${env.project}' is not a PRJ-<n>-<slug> id.`);
  const to = boardOf(env.owner, req.to);
  if (!to) return refuse(`--to takes a project id like PRJ-119-gov-iam, not '${req.to}'.`);
  if (req.to === env.project) return refuse("a project does not signal itself.");
  if (!req.title.trim()) return refuse("a signal needs a title (--title).");

  const marker = renderMarker({ kind: req.kind, from: env.project, to: req.to, items: req.items });
  const body = [
    req.body.trim(),
    "",
    `**Signal:** ${req.kind} · **From:** ${env.project} · **To:** ${req.to}`,
    ...(req.items.length ? ["", "Items:", ...req.items.map((i) => `- ${i}`)] : []),
    "",
    marker,
  ].join("\n").trimStart();

  const created = await env.tracker.create(env.govRepo, { title: req.title.trim(), body, assignee: env.login, labels: [signalLabel(req.kind)] });
  if (!created.ok) return refuse(`the signal was not sent — the issue could not be created in ${env.govRepo.owner}/${env.govRepo.name}: ${created.reason}`);
  const ref = created.value;
  const lines = [`Sent ${req.kind} → ${req.to}`, `  ${ref.url}`, `  labelled ${signalLabel(req.kind)}, assigned to ${env.login}`];
  let ok = true;

  const onTo = await env.tracker.addToProject(to, ref);
  if (onTo.ok) {
    const st = await env.tracker.setState(to, ref, "todo");
    lines.push(st.ok ? `  on ${req.to}'s board (Todo)` : `  on ${req.to}'s board — Status not set: ${st.reason}`);
  } else {
    lines.push(`  ⚠ could not be added to ${req.to}'s board (${onTo.reason}) — ${req.to} still finds it by label and marker (\`gov signal list\`)`);
  }

  const onFrom = await env.tracker.addToProject(from, ref);
  if (onFrom.ok) lines.push(`  on ${env.project}'s board (tracks the answer)`);
  else { ok = false; lines.push(`  ✗ could not be added to ${env.project}'s own board: ${onFrom.reason}`); }

  if (req.kind === "depends") {
    const targets: ItemRef[] = req.items.length ? req.items.map((url) => ({ url })) : [];
    if (!targets.length) {
      const a = await anchorOf(env.tracker, from);
      if (a) targets.push(a);
      else { ok = false; lines.push(`  ✗ ${env.project} has no anchor issue on its board to block — name what waits with --items`); }
    }
    for (const t of targets) {
      const l = await env.tracker.link(ref, t, "blocks");
      if (!l.ok) { ok = false; lines.push(`  ✗ ${t.url} could not be marked blocked by the signal: ${l.reason}`); }
      else lines.push(l.value.via === "native" ? `  ${t.url} is blocked by it` : `  ${t.url} is blocked by it (recorded as a marker comment — the tracker refused a native link)`);
    }
  }
  return { ok, url: ref.url, lines };
}

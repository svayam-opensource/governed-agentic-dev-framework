// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * `gov signal handover` — an ACT, not a request (spec 03 §4): `--items` leave the sender's board and join the
 * receiver's, and one signal issue, closed at once, records what moved and why. An item the receiver's board will
 * not take stays where it was — it is never dropped from both.
 */
import type { ItemRef } from "../ports/work-tracker.js";
import { renderMarker, signalLabel } from "./marker.js";
import { boardOf, type SignalEnv } from "./send.js";

export interface MoveRequest { readonly to: string; readonly title: string; readonly body: string; readonly items: readonly string[] }
export interface ActReport { readonly ok: boolean; readonly url: string | null; readonly lines: string[] }

/** Create the closed record of an act (handover, merge) on both boards. */
export async function recordAct(env: SignalEnv, kind: "handover" | "merge", req: MoveRequest, moved: readonly string[], notes: readonly string[]): Promise<{ url: string | null; lines: string[] }> {
  const from = boardOf(env.owner, env.project)!, to = boardOf(env.owner, req.to)!;
  const body = [
    req.body.trim(),
    "",
    `**Signal:** ${kind} · **From:** ${env.project} · **To:** ${req.to}`,
    "",
    moved.length ? "Moved:" : "Nothing moved.",
    ...moved.map((m) => `- ${m}`),
    ...(notes.length ? ["", ...notes] : []),
    "",
    renderMarker({ kind, from: env.project, to: req.to, items: moved }),
  ].join("\n").trimStart();
  const c = await env.tracker.create(env.govRepo, { title: req.title.trim(), body, assignee: env.login, labels: [signalLabel(kind)] });
  if (!c.ok) return { url: null, lines: [`  ✗ the record of this ${kind} could not be created: ${c.reason}`] };
  const lines = [`  recorded: ${c.value.url}`];
  for (const [p, name] of [[to, req.to], [from, env.project]] as const) {
    const a = await env.tracker.addToProject(p, c.value);
    if (!a.ok) lines.push(`  ⚠ the record is not on ${name}'s board: ${a.reason}`);
  }
  const cl = await env.tracker.close(c.value);
  if (!cl.ok) lines.push(`  ⚠ the record could not be closed: ${cl.reason}`);
  return { url: c.value.url, lines };
}

export async function handover(env: SignalEnv, req: MoveRequest): Promise<ActReport> {
  const refuse = (m: string): ActReport => ({ ok: false, url: null, lines: [m] });
  const from = boardOf(env.owner, env.project);
  const to = boardOf(env.owner, req.to);
  if (!from) return refuse(`the active project '${env.project}' is not a PRJ-<n>-<slug> id.`);
  if (!to) return refuse(`--to takes a project id like PRJ-119-gov-iam, not '${req.to}'.`);
  if (!req.items.length) return refuse("a handover names what moves: --items <url,url>.");
  if (!req.title.trim()) return refuse("a handover needs a title (--title).");

  const lines = [`Handover ${env.project} → ${req.to}`];
  const moved: string[] = [];
  let ok = true;
  for (const url of req.items) {
    const i: ItemRef = { url };
    const add = await env.tracker.addToProject(to, i);
    if (!add.ok) { ok = false; lines.push(`  ✗ ${url}: ${req.to}'s board refused it (${add.reason}) — kept on ${env.project}`); continue; }
    const rm = await env.tracker.removeFromProject(from, i);
    if (!rm.ok) lines.push(`  ⚠ ${url}: now on ${req.to}'s board, but could not be taken off ${env.project}'s (${rm.reason})`);
    else lines.push(`  moved ${url}`);
    moved.push(url);
  }
  const rec = await recordAct(env, "handover", req, moved, ok ? [] : ["Some items could not move; see the sender's report."]);
  if (!rec.url) ok = false;
  return { ok, url: rec.url, lines: [...lines, ...rec.lines] };
}

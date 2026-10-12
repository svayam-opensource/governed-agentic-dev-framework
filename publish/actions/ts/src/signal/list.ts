// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * `gov signal list` and the session manifest's "Incoming / Outgoing signals" lines (spec 03 §4). Discovery is by
 * label + MARKER in the gov repo, never by board membership — so a signal the sender could not put on this board is
 * still found, and offered for adding (Q5).
 */
import type { Result } from "../ports/result.js";
import { fail } from "../ports/result.js";
import { findSignals, type FoundSignal } from "./marker.js";
import { boardOf, type SignalEnv } from "./send.js";

export interface SignalList {
  readonly incoming: FoundSignal[];
  readonly outgoing: FoundSignal[];
  /** Incoming signals that are not on this project's board. */
  readonly notOnBoard: FoundSignal[];
}

export type SignalListResult = ({ readonly ok: true } & SignalList) | { readonly ok: false; readonly reason: string };

export async function listSignals(env: SignalEnv): Promise<SignalListResult> {
  const s = await env.tracker.search({ marker: "<!-- gov-signal", state: "open", repo: env.govRepo });
  if (!s.ok) return { ok: false, reason: s.reason };
  const { incoming, outgoing } = findSignals(s.value.map((i) => ({ url: i.ref.url, title: i.title, body: i.body, open: i.state === "open" })), env.project);
  const board = boardOf(env.owner, env.project);
  if (!board) return { ok: false, reason: `the active project '${env.project}' is not a PRJ-<n>-<slug> id` };
  const items = await env.tracker.items(board);
  const on = new Set(items.ok ? items.value.map((i) => i.ref.url) : []);
  return { ok: true, incoming, outgoing, notOnBoard: items.ok ? incoming.filter((x) => !on.has(x.url)) : [] };
}

/** Put incoming signals onto this project's board (`gov signal list --add`). One result per signal. */
export async function addIncomingToBoard(env: SignalEnv, signals: readonly FoundSignal[]): Promise<Result<void>[]> {
  const board = boardOf(env.owner, env.project);
  if (!board) return signals.map(() => fail(`'${env.project}' is not a project id`));
  const out: Result<void>[] = [];
  for (const s of signals) out.push(await env.tracker.addToProject(board, { url: s.url }));
  return out;
}

const one = (s: FoundSignal, dir: "from" | "to"): string => `${s.kind} ${dir} ${dir === "from" ? s.from : s.to} — ${s.title} (${s.url})`;

/** The two manifest lines, exactly as the session protocol shows them. */
export function manifestLines(l: Pick<SignalList, "incoming" | "outgoing">): [string, string] {
  return [
    `- **Incoming signals:** ${l.incoming.length ? l.incoming.map((s) => one(s, "from")).join("; ") : "none"}`,
    `- **Outgoing signals:** ${l.outgoing.length ? l.outgoing.map((s) => one(s, "to")).join("; ") : "none"}`,
  ];
}

// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * `gov signal ack <signal> [--answer …]` — the RECEIVER closes a signal (spec 03 §4): an ask or depends with its
 * answer (the block then clears), a notice by acknowledging it. Only the project the marker names as `to` may.
 */
import { parseMarker } from "./marker.js";
import { boardOf, type SignalEnv } from "./send.js";

export async function ackSignal(env: SignalEnv, url: string, answer?: string): Promise<{ ok: boolean; lines: string[] }> {
  const it = await env.tracker.item({ url });
  if (!it.ok) return { ok: false, lines: [`could not read ${url}: ${it.reason}`] };
  const m = parseMarker(it.value.body);
  if (!m) return { ok: false, lines: [`${url} is not a gov signal (no gov-signal marker).`] };
  if (m.to !== env.project) return { ok: false, lines: [`only ${m.to} can acknowledge this ${m.kind} — the active project is ${env.project}.`] };
  if (it.value.state === "closed") return { ok: true, lines: [`${url} is already closed.`] };
  const needsAnswer = m.kind === "ask" || m.kind === "depends";
  if (needsAnswer && !answer?.trim()) return { ok: false, lines: [`an ${m.kind} is closed with its answer: gov signal ack ${url} --answer "…"`] };

  const lines: string[] = [];
  const text = answer?.trim() ? answer.trim() : `Acknowledged by ${env.login} for ${env.project}.`;
  const c = await env.tracker.comment({ url }, text);
  if (!c.ok) return { ok: false, lines: [`not closed — the answer could not be written: ${c.reason}`] };
  const board = boardOf(env.owner, env.project);
  if (board) {
    const st = await env.tracker.setState(board, { url }, "done");
    if (!st.ok) lines.push(`  board: Status not set — ${st.reason}`);
  }
  const cl = await env.tracker.close({ url });
  if (!cl.ok) return { ok: false, lines: [`the answer is written but ${url} could not be closed: ${cl.reason}`, ...lines] };
  return { ok: true, lines: [`${m.kind} from ${m.from} closed${needsAnswer ? " with your answer" : ""}`, `  ${url}`, ...lines] };
}

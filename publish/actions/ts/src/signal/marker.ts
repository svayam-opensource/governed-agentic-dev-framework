// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/** The machine-readable part of a signal issue: `<!-- gov-signal {json} -->` (spec 03 §4). Pure. */
import { SIGNAL_KINDS, type SignalKind, type SignalMarker } from "./model.js";

export { SIGNAL_KINDS };

export const signalLabel = (k: SignalKind): string => `gov-signal:${k}`;

export function renderMarker(m: SignalMarker): string {
  return `<!-- gov-signal ${JSON.stringify({ kind: m.kind, from: m.from, to: m.to, items: [...m.items] })} -->`;
}

const MARKER = /<!--\s*gov-signal\s+(\{[\s\S]*?\})\s*-->/;

/** The marker in an issue body, or null when there is none or it does not hold a well-formed signal. */
export function parseMarker(body: string): SignalMarker | null {
  const m = MARKER.exec(body);
  if (!m) return null;
  let v: unknown;
  try { v = JSON.parse(m[1]); } catch { return null; /* a broken marker is not a signal; list shows only real ones */ }
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  if (!(SIGNAL_KINDS as readonly string[]).includes(o.kind as string)) return null;
  if (typeof o.from !== "string" || typeof o.to !== "string" || !o.from || !o.to) return null;
  if (!Array.isArray(o.items) || !o.items.every((x) => typeof x === "string")) return null;
  return { kind: o.kind as SignalKind, from: o.from, to: o.to, items: o.items as string[] };
}

export interface SignalIssue { readonly url: string; readonly title: string; readonly body: string; readonly open: boolean }
export interface FoundSignal extends SignalMarker { readonly url: string; readonly title: string }

/** Open signals for `project`, split by direction — the manifest's Incoming / Outgoing lines. */
export function findSignals(issues: readonly SignalIssue[], project: string): { incoming: FoundSignal[]; outgoing: FoundSignal[] } {
  const incoming: FoundSignal[] = [], outgoing: FoundSignal[] = [];
  for (const i of issues) {
    if (!i.open) continue;
    const m = parseMarker(i.body);
    if (!m) continue;
    const f: FoundSignal = { ...m, url: i.url, title: i.title };
    if (m.to === project) incoming.push(f);
    if (m.from === project) outgoing.push(f);
  }
  return { incoming, outgoing };
}

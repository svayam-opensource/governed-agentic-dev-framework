// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * A signal DRAFT — what an agent may write (Q6): `projects/<PRJ>/signals/drafts/<name>.md`, front matter
 * `kind`, `to`, `title`, optional `items`, then the body. A person sends it with `gov signal send <draft>`.
 */
import yaml from "js-yaml";
import { fail, ok, type Result } from "../ports/result.js";
import { SIGNAL_KINDS, type SignalKind } from "./model.js";

export interface SignalDraft { readonly kind: SignalKind; readonly to: string; readonly title: string; readonly items: string[]; readonly body: string }

export function parseDraft(text: string): Result<SignalDraft> {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text);
  if (!m) return fail("a signal draft opens with front matter (--- kind / to / title ---)");
  let fm: Record<string, unknown>;
  try { fm = (yaml.load(m[1]) ?? {}) as Record<string, unknown>; } catch (e) { return fail(`the draft's front matter is not YAML: ${(e as Error).message.split("\n")[0]}`); }
  const kind = String(fm.kind ?? "");
  if (!(SIGNAL_KINDS as readonly string[]).includes(kind)) return fail(`kind: must be one of ${SIGNAL_KINDS.join(", ")} (found '${kind}')`);
  if (typeof fm.to !== "string" || !fm.to.trim()) return fail("to: names the receiving project (PRJ-<n>-<slug>)");
  if (typeof fm.title !== "string" || !fm.title.trim()) return fail("title: is required");
  const items = Array.isArray(fm.items) ? fm.items.map(String) : [];
  return ok({ kind: kind as SignalKind, to: fm.to.trim(), title: fm.title.trim(), items, body: m[2].trim() });
}

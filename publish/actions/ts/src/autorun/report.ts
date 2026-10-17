// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/** The run report (spec 03 §3.5): one line per item — `03-x spec  ✋ waiting on … (review CR #512)`. */
import type { Classification } from "./classify.js";

export type ItemResult =
  | { readonly kind: "advanced"; readonly detail: string }
  | { readonly kind: "waiting" }
  | { readonly kind: "would"; readonly step: string }
  | { readonly kind: "failed"; readonly detail: string }
  | { readonly kind: "halted"; readonly detail: string }
  | { readonly kind: "not-started"; readonly why: string };

export function reportLine(c: Classification, r: ItemResult): string {
  const head = `${c.id.padEnd(12)} ${c.stage.padEnd(7)}`;
  switch (r.kind) {
    case "advanced": return `${head} → ${c.next} done${r.detail ? ` (${r.detail})` : ""}; ✋ now waiting on ${c.waitingOn}`;
    case "waiting": return `${head} ✋ waiting on ${c.waitingOn}`;
    case "would": return `${head} would ${r.step}, then wait on ${c.waitingOn}`;
    case "failed": return `${head} ✗ failed: ${r.detail}`;
    case "halted": return `${head} ✗ HALT (C01): ${r.detail}`;
    case "not-started": return `${head} not started — ${r.why}`;
  }
}

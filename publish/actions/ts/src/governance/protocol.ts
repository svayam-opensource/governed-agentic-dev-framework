// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * Session-start protocol integrity check (SDD-030/032, #54) — port of
 * check_protocol.py. Gates that the protocol is DELIVERED: the canonical file
 * exists, still carries its §0 mandate, and the configured client gates have all
 * their hook parts present.
 *
 * NOTE: the render-harness `--check` (generated copies match the canonical) is
 * DEFERRED — it needs the Node harness renderer (no shelling to bash). Tracked.
 */
import * as path from "node:path";
import type { ValidateContext, ValidationResult } from "./validate.js";

/**
 * Stable §0 anchors — if any disappears, the core mandate was gutted.
 *
 * REWRITTEN AFTER THE 2026-09-11 RESTRUCTURE, and the reason it went unnoticed is the point.
 * The old anchors were "agent speaks first" and "before you change any code", phrases from the
 * pre-restructure §0. The restructure replaced that section with the Policy-Owner-approved
 * "Before any meaningful work" — so this check should have failed from that day. It did not,
 * because it reads `publish/content/agent/session-protocol.md`, and THAT copy had drifted to
 * the old protocol. The validator was asserting a stale file against stale phrases and agreeing
 * with itself.
 *
 * Syncing the shipped copy to the render source is what surfaced it.
 *
 * These anchors are now the load-bearing sentences of the approved §0: what the first reply
 * must be, and that work is refused until it happens. Phrases, not headings, so a reworded
 * title does not trip it and a gutted mandate does.
 */
// LOWERCASE, because the check lowercases the document before comparing. My first version of
// this list had "Before any meaningful work" with a capital B, which can never match — a broken
// check that reports the mandate missing from a protocol that carries it.
const MANDATE_ANCHORS = ["context manifest", "refuse meaningful work", "before any meaningful work"];

// THE CLIENT-GATE CHECKS ARE GONE (Decision 4, 2026-09-14).
//
// They asserted that if `.claude/settings.json` mentions a session-start hook, then
// `.claude/hooks/{session-start,pre-tool-gate,session-ack}.sh` and
// `.claude/commands/session-start.md` all exist and are non-empty — and the same for Cursor.
//
// gov no longer ships any of those files. They never fired anyway: every launch uses the
// project directory as cwd and the harness mirror never carried them, so they sat in the
// governance worktree where no agent looks. Two of nine approved agents having a gate the rest
// cannot have would bias agent choice (POL-430).
//
// Keeping the check would be worse than useless: a developer's OWN .claude/settings.json is
// theirs, and gov reporting their hooks as "missing/empty" is gov policing a file it has no
// business in — and was explicitly changed to stop writing.

export function checkProtocol(ctx: ValidateContext): ValidationResult {
  const errors: string[] = [];
  const read = (rel: string): string | null => ctx.fs.readFile(path.join(ctx.repoRoot, rel));

  const protocol = read("agent/session-protocol.md");
  if (protocol === null) {
    return { name: "protocol", ok: false, errors: ["agent/session-protocol.md is missing — the session-start protocol is undelivered"] };
  }
  if (protocol.trim() === "") {
    errors.push("agent/session-protocol.md is empty");
  } else {
    const low = protocol.toLowerCase();
    const missing = MANDATE_ANCHORS.filter((a) => !low.includes(a));
    if (missing.length) errors.push(`agent/session-protocol.md no longer contains its §0 mandate (missing: ${missing.join(", ")})`);
  }

  return { name: "protocol", ok: errors.length === 0, errors };
}

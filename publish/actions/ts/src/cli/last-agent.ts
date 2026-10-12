// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * THE AGENT YOU USED LAST TIME ON THIS PROJECT (Policy Owner, 2026-10-12).
 *
 * The picker's default (Enter) is:
 *   resuming a project already seeded   → the agent this person last opened on it
 *   seeding a project from scratch      → the organization's default
 *   the last one no longer approved/installed → the organization's default
 *
 * So gov has to remember, per project and per developer, which agent was opened. That is gov's own state about
 * this person's work on this machine — not policy, not a preference, and not something the governance repository
 * should carry — so it lives with the rest of gov's per-person state (state-paths.ts), one file per project,
 * keyed by what it is ABOUT:
 *
 *   <work-root>/preferences/<gh-login>/state/agent/<PROJECT_ID>.json   { "agent": "claude-code", "at": "…" }
 *
 * `agent` is the LAUNCH kind, so Cursor's editor (`cursor-gui`) is remembered apart from its CLI (`cursor`).
 * A missing or unreadable file is the ordinary "never opened here" answer, never a failure.
 */
import * as path from "node:path";
import type { Fs } from "../lifecycle/fs-io.js";
import { stateDir } from "../state-paths.js";

/** `<work-root>/preferences/<login>/state/agent/<PROJECT_ID>.json`. PURE. */
export function lastAgentFile(workRoot: string, login: string, projectId: string): string {
  const safe = projectId.replace(/[^A-Za-z0-9._-]+/g, "-");
  return path.join(stateDir(workRoot, login), "agent", `${safe}.json`);
}

/** The launch kind last opened on `projectId` by `login`, or null when there is none (or it cannot be read). */
export function readLastAgent(fs: Fs, workRoot: string, login: string | null, projectId: string): string | null {
  if (!login) return null;
  const raw = fs.readFile(lastAgentFile(workRoot, login, projectId));
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as { agent?: unknown };
    return typeof v.agent === "string" && v.agent ? v.agent : null;
  } catch {
    return null;   // a damaged record is "no record": the org default answers instead
  }
}

/** Record the agent just chosen. Best-effort: failing to remember must never stop the agent opening. */
export function writeLastAgent(fs: Fs, workRoot: string, login: string | null, projectId: string, agent: string, now: Date = new Date()): void {
  if (!login) return;
  try {
    const file = lastAgentFile(workRoot, login, projectId);
    fs.mkdirp(path.dirname(file));
    fs.writeFile(file, `${JSON.stringify({ agent, at: now.toISOString() })}\n`);
  } catch { /* remembered next time instead */ }
}

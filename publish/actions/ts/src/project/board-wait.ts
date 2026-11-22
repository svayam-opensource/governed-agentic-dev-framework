// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * Waiting out GitHub's project index before `gov seed` — shared by `gov project --seed` (cli/project-verb.ts) and the
 * practice project made at first run (lifecycle/starter-project.ts).
 */
import type { WorkTrackerPort } from "../ports/work-tracker.js";
import type { Created } from "./create.js";

export interface BoardWaitDeps {
  readonly tracker: WorkTrackerPort;
  /** How long to wait for the board to list its new anchor (default 90 s), and how to wait (tests: no-op). */
  readonly boardWaitMs?: number;
  readonly sleep?: (ms: number) => Promise<void>;
}

const POLL_MS = 3000;

/**
 * Does the board LIST the anchor yet? GitHub's project item index is eventually consistent: an item added a second ago
 * can be missing from the list for a minute, and `gov seed` then stops at "GitHub Project has no linked Issues or PRs"
 * (svayam-e2e, run 38481578886 — the same lag the adopter journey polls for). So `--seed` asks the board first.
 */
export async function boardListsAnchor(
  d: BoardWaitDeps, created: Created,
): Promise<boolean> {
  const board = created.board?.ref;
  const anchor = created.anchor?.url;
  if (!board || !anchor) return true;               // nothing to wait for — seed reports what is missing
  const sleep = d.sleep ?? ((ms: number) => new Promise<void>((res) => setTimeout(res, ms)));
  const tries = Math.max(1, Math.ceil((d.boardWaitMs ?? 90_000) / POLL_MS));
  for (let i = 0; i < tries; i++) {
    const items = await d.tracker.items(board);
    // Only the LAG is waited out: a board that cannot be read at all is seed's to report, at once, in its own words.
    if (!items.ok || items.value.some((it) => it.ref.url === anchor)) return true;
    if (i < tries - 1) await sleep(POLL_MS);
  }
  return false;
}

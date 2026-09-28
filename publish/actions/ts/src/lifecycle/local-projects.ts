// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * WHAT IS ALREADY ON THIS MACHINE — the project list that costs no GitHub call.
 *
 * `agent_work_root` holds one folder per project a person has opened here, and that folder is the
 * cheapest, truest answer to "which project do you want?": on the walk that prompted the picker
 * design, every project the walker wanted was already cloned, and gov still spent two org-wide `gh`
 * calls plus up to one write-access check per board before offering it (design §5: 2 + ~100 → 0).
 *
 * The scan reads a directory listing, one `HEAD` file per project and one mtime. It NEVER consults
 * GitHub — not even to find out that a board has since closed, which is why that mark is added later,
 * by the caller, and only if GitHub was going to be asked anyway (design §3.1).
 */
import * as path from "node:path";
import type { Fs } from "./fs-io.js";
import { boardNumberFromProjectId } from "./task.js";

export interface LocalProject {
  readonly projectId: string;
  /** `<agent_work_root>/<projectId>` — where an agent would be launched. */
  readonly dir: string;
  readonly boardNumber: number | null;
  /** The branch the workspace worktree is on, or null when gov could not read one (see {@link branchFromHead}). */
  readonly branch: string | null;
  /** The folder's mtime — "when you last used it". Null when the port cannot report one. */
  readonly lastUsedMs: number | null;
  /** Is the workspace repo actually cloned in it? A half-made folder is a `join`, not a launch. */
  readonly cloned: boolean;
}

/** A project folder, by name: `PRJ-<board>-<slug>`. `preferences/`, `state/` and dotfiles live beside them. */
const PROJECT_DIR = /^PRJ-\d+(-|$)/i;
export const isProjectDirName = (name: string): boolean => PROJECT_DIR.test(name);

/**
 * The branch from a `.git/HEAD`'s text.
 *
 * `ref: refs/heads/<branch>` is the ordinary case. A DETACHED head is a bare sha, and a linked
 * worktree's `.git` is a FILE (`gitdir: …`) whose HEAD is somewhere else — in both of those gov does
 * not know the branch, and says so by returning null rather than printing a sha as if it were one.
 * Nothing downstream depends on it: the branch is a hint in a list row, never a decision.
 */
export function branchFromHead(head: string | null): string | null {
  const m = /^ref:\s*refs\/heads\/(.+?)\s*$/m.exec(head ?? "");
  return m ? m[1]! : null;
}

/**
 * Every project folder under `workRoot`, from the disk alone.
 *
 * `mtimeMs` is optional on the `Fs` port because every existing test double predates it; without it
 * the rows carry no "last used" and {@link orderLocal} falls back to board order — a visible,
 * explicable degradation rather than an invented timestamp.
 */
export function scanLocalProjects(fs: Fs, workRoot: string, workspaceRepo: string): LocalProject[] {
  const out: LocalProject[] = [];
  for (const name of fs.readdir(workRoot)) {
    if (!isProjectDirName(name)) continue;            // preferences/, state/, and anything else beside them
    const dir = path.join(workRoot, name);
    const gitDir = path.join(dir, workspaceRepo, ".git");
    out.push({
      projectId: name,
      dir,
      boardNumber: boardNumberFromProjectId(name),
      branch: branchFromHead(fs.readFile(path.join(gitDir, "HEAD"))),
      lastUsedMs: fs.mtimeMs?.(dir) ?? null,
      cloned: fs.pathExists(gitDir),
    });
  }
  return out;
}

/**
 * The local list's order — `work.picker.localOrder` (design, decision 2 for the Policy Owner).
 *
 * `last-used` (the default) is what somebody continuing yesterday's work is reaching for; `number`
 * is the order the two GitHub lists use, for anyone who would rather have one order everywhere.
 * A folder with no readable mtime sorts after the ones that have one, never above them, and ties
 * fall back to board order so the list is stable between runs.
 */
export function orderLocal(items: readonly LocalProject[], order: "last-used" | "number"): LocalProject[] {
  const byNumber = (a: LocalProject, b: LocalProject): number => (b.boardNumber ?? -1) - (a.boardNumber ?? -1) || a.projectId.localeCompare(b.projectId);
  if (order === "number") return [...items].sort(byNumber);
  return [...items].sort((a, b) => {
    if (a.lastUsedMs === b.lastUsedMs) return byNumber(a, b);
    if (a.lastUsedMs === null) return 1;
    if (b.lastUsedMs === null) return -1;
    return b.lastUsedMs - a.lastUsedMs;
  });
}

/** "today" · "3 days ago" · "" when the port could not say. A row's hint, never a fact anything decides on. */
export function lastUsedLabel(lastUsedMs: number | null, nowMs: number): string {
  if (lastUsedMs === null) return "";
  const days = Math.floor((nowMs - lastUsedMs) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days} days ago`;
  const months = Math.floor(days / 30);
  return months < 12 ? `${months} month${months === 1 ? "" : "s"} ago` : `over a year ago`;
}

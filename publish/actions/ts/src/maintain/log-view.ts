// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * `gov log` — finding a run's file (PRJ-121, 2026-09-23).
 *
 * One file per run is only useful if the files can be found: without this, a person has to know the layout,
 * the day and the run id to read what gov recorded. So `gov log` lists recent runs one line each, `--last`
 * opens the newest, `<run-id>` opens the one named in a failure message, and `--project` narrows to a project.
 *
 * The parsing half is pure (folder names in, runs out), because the layout is what has to stay right; the
 * reading half takes a tiny fs port, so the tests need no disk.
 */

export interface RunEntry {
  readonly day: string;          // 2026-09-23
  readonly time: string;         // 184107
  readonly id: string;           // 7f3a
  readonly project: string;      // PRJ-121-doc-update-issue-116 · none
  readonly command: string;      // work
  readonly dir: string;          // <logs>/<day>/<folder>
}

/** `HHMMSS-<run>-<project>-<command>` → its parts. Null for a name gov did not write. */
export function parseRunFolder(day: string, name: string, logsRoot: string): RunEntry | null {
  const m = /^(\d{6})-([0-9a-f]{4})-(.+?)-([^-]+)$/.exec(name);
  if (!m) return null;
  return { day, time: m[1]!, id: m[2]!, project: m[3]!, command: m[4]!, dir: `${logsRoot}/${day}/${name}` };
}

export interface LogFs {
  /** Directory entries, newest-irrelevant order; missing → empty. */
  readonly list: (dir: string) => readonly string[];
}

/** Every run gov has kept, newest first. */
export function listRuns(fs: LogFs, logsRoot: string): RunEntry[] {
  const days = [...fs.list(logsRoot)].filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort().reverse();
  const out: RunEntry[] = [];
  for (const day of days) {
    const runs = [...fs.list(`${logsRoot}/${day}`)].sort().reverse();
    for (const r of runs) { const e = parseRunFolder(day, r, logsRoot); if (e) out.push(e); }
  }
  return out;
}

export interface LogQuery {
  readonly runId?: string;
  readonly project?: string;
  readonly last?: boolean;
  readonly limit?: number;
}

/** The runs a query asks for, newest first. */
export function selectRuns(runs: readonly RunEntry[], q: LogQuery): RunEntry[] {
  let out = [...runs];
  if (q.runId) out = out.filter((r) => r.id === q.runId);
  if (q.project) { const p = q.project.toLowerCase(); out = out.filter((r) => r.project.toLowerCase().includes(p)); }
  if (q.last) out = out.slice(0, 1);
  return out.slice(0, q.limit ?? out.length);
}

/** One line per run: when, which run, which project, what was typed. */
export function formatRuns(runs: readonly RunEntry[]): string[] {
  if (!runs.length) return ["  no runs recorded yet"];
  const t = (s: string): string => `${s.slice(0, 2)}:${s.slice(2, 4)}:${s.slice(4, 6)}`;
  return runs.map((r) => `  ${r.day} ${t(r.time)}  ${r.id}  ${r.project.padEnd(28)} ${r.command}`);
}

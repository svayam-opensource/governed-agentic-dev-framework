// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * ONE AUTORUN PER PROJECT (spec 03 §3.4). The lock is a file in gov's state dir, created exclusively. A lock older
 * than the run budget is REPORTED as stale and left in place — a person removes it; gov never guesses that the
 * other run is dead.
 */
export interface LockFs {
  /** Create `path` with `text` only if it does not exist; false when it already does. */
  createExclusive(path: string, text: string): boolean;
  read(path: string): string | null;
  remove(path: string): void;
}

export const lockPath = (stateDir: string, project: string): string => `${stateDir.replace(/\/+$/, "")}/autorun/${project}.lock`;

export type LockResult =
  | { readonly ok: true; readonly path: string }
  | { readonly ok: false; readonly stale: boolean; readonly message: string; readonly path: string };

export function acquireLock(fs: LockFs, stateDir: string, project: string, runId: string, now: Date, runBudgetMs: number): LockResult {
  const p = lockPath(stateDir, project);
  if (fs.createExclusive(p, JSON.stringify({ runId, startedAt: now.toISOString() }) + "\n")) return { ok: true, path: p };
  let held: { runId?: string; startedAt?: string } = {};
  try { held = JSON.parse(fs.read(p) ?? "{}"); } catch { /* unreadable: reported as held by an unknown run */ }
  const since = held.startedAt ? Date.parse(held.startedAt) : NaN;
  const stale = Number.isFinite(since) && now.getTime() - since > runBudgetMs;
  const who = `run ${held.runId ?? "(unknown)"} since ${held.startedAt ?? "(unknown)"}`;
  return {
    ok: false, stale, path: p,
    message: stale
      ? `autorun lock for ${project} is stale (${who}, older than the run budget). If that run is gone, remove ${p} and run again.`
      : `another autorun is working on ${project} (${who}). One run per project at a time.`,
  };
}

/** Remove the lock only when it is ours. */
export function releaseLock(fs: LockFs, stateDir: string, project: string, runId: string): void {
  const p = lockPath(stateDir, project);
  try { if ((JSON.parse(fs.read(p) ?? "{}") as { runId?: string }).runId === runId) fs.remove(p); } catch { /* not ours to judge */ }
}

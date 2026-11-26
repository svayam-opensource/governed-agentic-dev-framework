// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * `gov setup`'s clone of the governance repo it just created (PRJ-121 F160, Policy Owner ruling A 2026-11-26).
 *
 * The clone ran through `tryRun`, which keeps gh's stderr for the log only. When the connection dropped
 * (`fetch-pack: unexpected disconnect while reading sideband packet`), the adopter read "was created but could
 * not be cloned" with no reason, and neither they nor we could tell a dropped network from a missing `git`.
 * Now gh's own last lines are shown, the clone is tried ONCE more (a dropped connection is the common cause),
 * and the partial directory a failed clone leaves is removed before the retry, so gh does not refuse with
 * "destination path already exists".
 *
 * No progress bar and no network tuning: gov assumes a working connection (Policy Owner 2026-11-25). The
 * process runner and the directory removal are injected, so the decision is tested without a network.
 */

/** One run of `gh repo clone`: its exit status and stderr. */
export type RunClone = (nameWithOwner: string, dest: string) => { readonly status: number; readonly stderr: string };

export type CloneResult =
  | { readonly kind: "cloned"; readonly attempts: number }
  | { readonly kind: "failed"; readonly attempts: number; readonly reason: string };

/** The last few non-empty lines of gh's stderr: enough to recognise the failure, short enough to read. */
export function cloneFailureReason(stderr: string, maxLines = 3): string {
  const lines = stderr.split(/\r?\n/).map((l) => l.trim()).filter((l) => l !== "");
  return lines.length ? lines.slice(-maxLines).join("\n") : "gh gave no reason";
}

export interface CloneDeps {
  readonly runClone: RunClone;
  /** Remove a directory and everything in it; a missing directory is not an error. */
  readonly rmDir: (dir: string) => void;
  /** Told before the retry, so the adopter knows the wait is gov's and not a hang. */
  readonly note?: (line: string) => void;
}

export function cloneGovRepo(deps: CloneDeps, nameWithOwner: string, dest: string, attempts = 2): CloneResult {
  let reason = "gh gave no reason";
  for (let n = 1; n <= attempts; n++) {
    const r = deps.runClone(nameWithOwner, dest);
    if (r.status === 0) return { kind: "cloned", attempts: n };
    reason = cloneFailureReason(r.stderr);
    deps.rmDir(dest);
    if (n < attempts) deps.note?.(`  clone failed (${reason.split("\n").pop()}) — trying once more…`);
  }
  return { kind: "failed", attempts, reason };
}

/** What `gov setup` prints when the clone failed twice: the cause first, then the resume path. */
export function cloneFailedLines(full: string, reason: string): string[] {
  return [
    `gov setup: ${full} was created but could not be cloned. gh said:`,
    ...reason.split("\n").map((l) => `    ${l}`),
    `  the repository still exists — re-run 'gov setup ${full}' to resume, or clone it yourself.`,
  ];
}

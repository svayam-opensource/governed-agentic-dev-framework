// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * `gov setup`'s first push of the default branch (gadf#180, PRJ-121 intent 05 Item 2).
 *
 * It was `git push -u origin HEAD` with no fetch. A remote that moved while setup ran — another admin, a template
 * copy still landing — met a push that git rejected, and the adopter read "push failed, run: git push", which
 * fails the same way. Now the remote is fetched first; if its default branch is not an ancestor of what setup
 * committed, gov stops and says what to do. It NEVER forces: the commits it would overwrite are somebody's.
 *
 * Plain git through an injected runner, so the decision is tested against real repositories (first-push.test.ts).
 */
import type { RunGit } from "../lifecycle/vcs.js";

export const REMOTE_MOVED_HINT = "the remote moved — run `git pull --rebase`, then `gov setup` again";

export type FirstPushResult =
  | { readonly kind: "pushed" }
  | { readonly kind: "remote-moved"; readonly message: string }
  | { readonly kind: "push-failed"; readonly message: string };

export function firstPush(runGit: RunGit, home: string, remote = "origin"): FirstPushResult {
  const g = (...a: string[]) => runGit(["-C", home, ...a]);
  const head = g("rev-parse", "--abbrev-ref", "HEAD");
  const branch = head.status === 0 ? head.stdout.trim() : "";
  if (!branch || branch === "HEAD") return { kind: "push-failed", message: "no branch is checked out — run: git push" };

  // Is the branch on the remote at all? An empty repository (or one whose default branch has another name) has
  // nothing to have moved, and the push below is a plain create.
  const listed = g("ls-remote", "--heads", remote, branch);
  if (listed.status !== 0) {
    return { kind: "push-failed", message: `could not reach ${remote}${listed.stderr ? `: ${listed.stderr.trim()}` : ""} — run: git push` };
  }
  if (listed.stdout.trim() !== "") {
    const fetched = g("fetch", "--no-tags", remote, `+refs/heads/${branch}:refs/remotes/${remote}/${branch}`);
    if (fetched.status !== 0) {
      return { kind: "push-failed", message: `could not fetch ${remote}/${branch} — run: git push` };
    }
    if (g("merge-base", "--is-ancestor", `refs/remotes/${remote}/${branch}`, "HEAD").status !== 0) {
      return { kind: "remote-moved", message: `${remote}/${branch} has commits this clone does not: ${REMOTE_MOVED_HINT}` };
    }
  }
  const pushed = g("push", "-u", remote, "HEAD");
  return pushed.status === 0
    ? { kind: "pushed" }
    : { kind: "push-failed", message: `push failed${pushed.stderr ? ` (${pushed.stderr.trim().split("\n").pop()})` : ""} — run: git push` };
}

// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * THE PULL REQUEST'S BRANCH, WRITABLE, IN CI — the disk side of {@link PrBranch} (P3 wave 2).
 *
 * A pull_request workflow checks out a MERGE commit, detached; a proposal must land on the pull request's own
 * branch. So: fetch the head commit, add a throwaway worktree at it, let the writers write there, then commit
 * `policies/` as the gov bot and push `HEAD:refs/heads/<head ref>`. The checkout's own credentials push it (the
 * workflow grants `contents: write`). Every git call goes through the run-process chokepoint.
 */
import { mkdtempSync, rmSync } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { runResult } from "../run-process.js";
import { log } from "../log.js";
import { fsTree } from "../rules/policy-pr/tree.js";
import type { PrBranch } from "./rules-propose-ci.js";

const PGM = "gov-work:cli:pr-branch-io";

export interface BotIdentity { readonly name: string; readonly email: string; }

/** The default bot: the identity GitHub Actions' own token commits as. `GOV_BOT_NAME`/`GOV_BOT_EMAIL` override. */
export function botIdentity(env: Readonly<Record<string, string | undefined>>): BotIdentity {
  return {
    name: env.GOV_BOT_NAME || "github-actions[bot]",
    email: env.GOV_BOT_EMAIL || "41898282+github-actions[bot]@users.noreply.github.com",
  };
}

export function openPrBranch(repoDir: string, headSha: string, headRef: string, bot: BotIdentity): PrBranch | { readonly error: string } {
  const git = (cwd: string, args: string[]) => runResult("git", ["-C", cwd, ...args], { pgm: PGM, fn: args[0] });
  if (!headSha || !headRef) return { error: "the event names no head commit or branch" };
  // Shallow checkouts may not hold the head commit: fetch it (harmless when it is already there).
  git(repoDir, ["fetch", "--no-tags", "--depth=50", "origin", headSha]);
  const dir = mkdtempSync(path.join(os.tmpdir(), "gov-propose-"));
  const add = git(repoDir, ["worktree", "add", "--detach", dir, headSha]);
  if (add.status !== 0) {
    rmSync(dir, { recursive: true, force: true });
    return { error: `git worktree add failed: ${add.stderr.trim().split("\n").pop() ?? ""}` };
  }
  return {
    tree: fsTree(dir),
    commit(message) {
      git(dir, ["add", "-A", "--", "policies"]);
      if (git(dir, ["diff", "--cached", "--quiet"]).status === 0) return { nothing: true };
      const c = git(dir, ["-c", `user.name=${bot.name}`, "-c", `user.email=${bot.email}`, "commit", "--no-verify", "-m", message]);
      if (c.status !== 0) return { error: `git commit failed: ${c.stderr.trim().split("\n").pop() ?? ""}` };
      const p = git(dir, ["push", "origin", `HEAD:refs/heads/${headRef}`]);
      if (p.status !== 0) return { error: `git push failed: ${p.stderr.trim().split("\n").pop() ?? ""}` };
      const sha = git(dir, ["rev-parse", "HEAD"]).stdout.trim();
      log("info", "gov committed a proposal to a pull request branch", PGM, "commit", { headRef, sha, bot: bot.name });
      return { sha };
    },
    close() {
      git(repoDir, ["worktree", "remove", "--force", dir]);
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

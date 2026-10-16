// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * WHAT CONFIGURE-IN-PLACE CHANGED, LANDED THE GOVERNED WAY (F17 + F20, svm-geneva re-walk 2026-10-07).
 *
 * `gov setup` with no argument rewrites org-config.yaml and policies/governance.yaml in the clone it is run in — on
 * `main`, as a rule — and used to end with "Next: run `gov app setup`". The person was left on the default branch with
 * uncommitted governance changes, and the obvious next step (commit, push) is itself a GOV-FRM-040 violation: every
 * change lands by a pull request someone authorized approves.
 *
 *   on the default branch   a branch (`gov-setup-<date>`), ONLY what setup changed, a commit, a push and
 *                           `gh pr create` — asked first; the clone then goes back to the default branch, as
 *                           `gov upgrade --pr` does. Non-interactive, declined, or a step failing: the exact
 *                           commands still to run are printed, with why.
 *   on another branch       already off the default branch, so nothing breaks GOV-FRM-040; setup commits nothing
 *                           for them (their branch, their commit) and says where the changes are.
 *
 * "Only what setup changed" is the porcelain status after setup minus the one before it, plus setup's own files:
 * a person's unrelated edits are never swept into setup's commit.
 *
 * F20: `finishInPlace` regenerates CODEOWNERS (and settles the role list's seeded tokens) BEFORE the landing, so the
 * routing change travels in the same pull request as the owner change that caused it.
 */
import { refreshCodeowners, settleRoleList } from "../maintain/upgrade-run.js";

export interface LandIo {
  /** `git -C <repo> …` → stdout, or null when it failed. */
  readonly git: (args: readonly string[]) => string | null;
  /** `gh …` in the repo → stdout, or null when it failed. */
  readonly gh: (args: readonly string[]) => string | null;
  readonly print: (line: string) => void;
  /** Absent: non-interactive — nothing is committed, the commands are printed. */
  readonly prompt?: (question: string, def: string) => Promise<string>;
}

export interface LandOptions {
  readonly defaultBranch: string;
  readonly today: string;
  /** `git status --porcelain -uall` from before setup ran. */
  readonly before: string;
  /** Setup's own files — landed whenever they changed, even if they were already dirty before. */
  readonly setupPaths: readonly string[];
}

/** Paths in `git status --porcelain` output; a rename is its new name. */
export function changedPaths(porcelain: string): string[] {
  return porcelain.split(/\r?\n/).filter((l) => l.length > 3).map((l) => {
    const p = l.slice(3);
    const arrow = p.indexOf(" -> ");
    return (arrow >= 0 ? p.slice(arrow + 4) : p).replace(/^"|"$/g, "");
  });
}

const quote = (p: string): string => (/^[A-Za-z0-9._/@-]+$/.test(p) ? p : `'${p.replace(/'/g, "'\\''")}'`);

/** F20 — regenerate CODEOWNERS from the owners setup just wrote, after settling the role list's seeded tokens. */
export function finishInPlace(repo: string): string[] {
  return [...settleRoleList(repo), ...refreshCodeowners(repo)];
}

export async function landSetupChanges(io: LandIo, o: LandOptions): Promise<number> {
  const after = io.git(["status", "--porcelain", "-uall"]) ?? "";
  const was = new Set(changedPaths(o.before));
  const now = changedPaths(after);
  const paths = now.filter((p) => !was.has(p) || o.setupPaths.includes(p));
  if (!paths.length) {
    io.print("  Setup changed no file in this repository — nothing to land.");
    return 0;
  }
  const current = io.git(["rev-parse", "--abbrev-ref", "HEAD"])?.trim() ?? "";
  const onDefault = current === o.defaultBranch || current === "" || current === "HEAD";
  if (!onDefault) {
    io.print("");
    io.print(`  Setup's changes are on branch ${current}, not committed: ${paths.join(", ")}.`);
    io.print("  Commit them there and open a pull request to land them — never a push to the default branch (GOV-FRM-040).");
    return 0;
  }

  let branch = `gov-setup-${o.today}`;
  for (let n = 2; io.git(["rev-parse", "--verify", "--quiet", `refs/heads/${branch}`]) !== null && n < 100; n++) branch = `gov-setup-${o.today}-${n}`;
  const title = "gov setup: configure governance for this organization";
  const body = [
    "`gov setup` (configure-in-place) changed these files:",
    "",
    ...paths.map((p) => `- \`${p}\``),
    "",
    "Landed by pull request: a change to the default branch is approved by someone authorized (GOV-FRM-040).",
  ].join("\n");
  const steps: { readonly show: string; readonly run: () => string | null }[] = [
    { show: `git switch -c ${branch}`, run: () => io.git(["switch", "-c", branch]) },
    { show: `git add -- ${paths.map(quote).join(" ")}`, run: () => io.git(["add", "--", ...paths]) },
    { show: `git commit -m "${title}"`, run: () => io.git(["commit", "-m", title]) },
    { show: `git push -u origin ${branch}`, run: () => io.git(["push", "-u", "origin", branch]) },
    { show: `gh pr create --base ${o.defaultBranch} --head ${branch} --title "${title}" --body "Configured by gov setup; lands by pull request (GOV-FRM-040)."`, run: () => io.gh(["pr", "create", "--base", o.defaultBranch, "--head", branch, "--title", title, "--body", body]) },
  ];
  const printSteps = (from: number): void => { for (const s of steps.slice(from)) io.print(`    ${s.show}`); };

  io.print("");
  io.print(`  Setup changed ${paths.length} file(s) on ${o.defaultBranch}: ${paths.join(", ")}.`);
  io.print(`  They land by a pull request — a commit pushed straight to ${o.defaultBranch} breaks GOV-FRM-040.`);
  const yes = io.prompt
    ? !/^n(o)?$/i.test((await io.prompt(`Put them on branch ${branch} and open the pull request now? [Y/n]`, "y")).trim())
    : false;
  if (!yes) {
    io.print("  Nothing was committed. To land them:");
    printSteps(0);
    return 0;
  }
  let url = "";
  for (let i = 0; i < steps.length; i++) {
    const r = steps[i]!.run();
    if (r === null) {
      io.print(`  ⚠ \`${steps[i]!.show.split(" --title")[0]}\` failed. Still to run:`);
      printSteps(i);
      if (i > 0) goBack(io, o.defaultBranch, branch);
      return 1;
    }
    if (i === steps.length - 1) url = r.trim().split(/\s+/).find((w) => /^https?:\/\//.test(w)) ?? r.trim();
  }
  io.print(`  Opened ${url || "the pull request"}  (${branch} → ${o.defaultBranch})`);
  goBack(io, o.defaultBranch, branch);
  io.print("  The new values take effect on the default branch when it merges.");
  return 0;
}

/** Back to the default branch, as `gov upgrade --pr` does: a clone left on a branch whose PR closes cannot resolve itself. */
function goBack(io: LandIo, defaultBranch: string, branch: string): void {
  if (io.git(["switch", defaultBranch]) === null) io.print(`  ⚠ could not switch back to ${defaultBranch} — the changes are on ${branch}; run: git switch ${defaultBranch}`);
  else io.print(`  This clone is back on ${defaultBranch}; setup's changes are on ${branch}.`);
}

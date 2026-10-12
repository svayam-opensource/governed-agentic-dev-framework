// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * A real-git project on disk, for the lifecycle tests that are about what git leaves behind (#214, #224):
 * a bare code-repo remote with a `dev` base, a bare workspace remote with `main`, and a workspace clone
 * already on the project branch. Nothing here touches the network.
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { execFileSync } from "node:child_process";

export const PROJECT_BRANCH = "BRNCH-43-reopen-test";
export const CODE_REPO_NAME = "911-SVM-LIB-SVC";

export interface GitProject {
  readonly tmp: string;
  /** The code repo's remote (a bare repo whose name ends in `<CODE_REPO_NAME>.git`). */
  readonly codeUrl: string;
  readonly agentWorkRoot: string;
  readonly projectWorkRoot: string;
  /** The workspace (gov) clone, on {@link PROJECT_BRANCH}, pushed. */
  readonly govClone: string;
  /** Where add-repo puts the code repo's worktree. */
  readonly codeDir: string;
  /** Where the shared base clone lives. */
  readonly baseClone: string;
  readonly git: (cwd: string, ...args: string[]) => string;
  readonly cleanup: () => void;
}

const IDENTITY = {
  GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t",
};

export function makeGitProject(): GitProject {
  // Commits made by the code under test (merges) need an identity too, and this machine's may be absent.
  const saved: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(IDENTITY)) { saved[k] = process.env[k]; process.env[k] = v; }

  const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "gov-reopen-")));
  const git = (cwd: string, ...args: string[]) =>
    execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, ...IDENTITY } });

  const remotes = path.join(tmp, "remotes");
  fs.mkdirSync(remotes);
  const bare = (name: string, branch: string): string => {
    const dir = path.join(remotes, `${name}.git`);
    execFileSync("git", ["init", "-q", "--bare", "-b", branch, dir]);
    const seedDir = path.join(tmp, `seed-${name}`);
    execFileSync("git", ["clone", "-q", dir, seedDir], { stdio: "ignore" });
    git(seedDir, "checkout", "-q", "-b", branch);
    fs.writeFileSync(path.join(seedDir, "README.md"), `${name}\n`);
    git(seedDir, "add", "README.md");
    git(seedDir, "commit", "-q", "-m", "init");
    git(seedDir, "push", "-q", "origin", branch);
    fs.rmSync(seedDir, { recursive: true, force: true });
    return dir;
  };
  const codeUrl = bare(CODE_REPO_NAME, "dev");
  const govUrl = bare("svm-prj-work", "main");

  const agentWorkRoot = path.join(tmp, "projects");
  const projectWorkRoot = path.join(agentWorkRoot, "PRJ-43-reopen-test");
  fs.mkdirSync(projectWorkRoot, { recursive: true });
  const govClone = path.join(projectWorkRoot, "svm-prj-work");
  execFileSync("git", ["clone", "-q", govUrl, govClone], { stdio: "ignore" });
  git(govClone, "checkout", "-q", "-b", PROJECT_BRANCH);
  git(govClone, "push", "-q", "-u", "origin", PROJECT_BRANCH);

  return {
    tmp, codeUrl, agentWorkRoot, projectWorkRoot, govClone,
    codeDir: path.join(projectWorkRoot, CODE_REPO_NAME),
    baseClone: path.join(agentWorkRoot, ".bases", CODE_REPO_NAME),
    git,
    cleanup: () => {
      fs.rmSync(tmp, { recursive: true, force: true });
      for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    },
  };
}

/** What `gov close` leaves behind for a reopened project: worktree present, project branch gone here and upstream. */
export function simulateClose(p: GitProject): void {
  p.git(p.codeDir, "checkout", "-q", "--detach", "origin/dev");
  p.git(p.baseClone, "branch", "-D", PROJECT_BRANCH);
  p.git(p.baseClone, "push", "-q", "origin", "--delete", PROJECT_BRANCH);
  p.git(p.baseClone, "fetch", "-q", "--prune", "origin");
}

/** Does `branch` exist on the code repo's remote? */
export function remoteHas(p: GitProject, branch: string): boolean {
  return p.git(p.baseClone, "ls-remote", "--heads", "origin", branch).trim().length > 0;
}

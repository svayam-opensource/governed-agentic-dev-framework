// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * The `Vcs` port (git) + `FsProbe` port, with `git`-CLI / node:fs adapters.
 * `git` is an external tool (not a legacy script), driven via an injected runner
 * so the adapter is testable without a real repo. Read-only queries + the
 * mutating operations seed needs for phases A/B/D and rollback.
 */
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
const defaultRunGit = (args) => {
    const r = spawnSync("git", args, { encoding: "utf8" });
    return { status: r.status ?? 1, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
};
/** A {@link Vcs} backed by the `git` CLI. `runGit` is injectable for tests. */
export function createGitVcs(runGit = defaultRunGit) {
    /** Run a git command, throwing on non-zero exit (for mutating steps). */
    const must = (args) => {
        const r = runGit(args);
        if (r.status !== 0) {
            throw new Error(`git ${args.join(" ")} failed (exit ${r.status})${r.stderr ? `: ${r.stderr.trim()}` : ""}`);
        }
        return r.stdout;
    };
    return {
        localBranchExists(repoDir, branch) {
            return (runGit(["-C", repoDir, "rev-parse", "--verify", "--quiet", `refs/heads/${branch}`]).status ===
                0);
        },
        remoteBranchExists(repoDir, remote, branch) {
            return runGit(["-C", repoDir, "ls-remote", "--exit-code", "--heads", remote, branch]).status === 0;
        },
        headSha(repoDir) {
            return must(["-C", repoDir, "rev-parse", "HEAD"]).trim();
        },
        refExists(repoDir, ref) {
            return runGit(["-C", repoDir, "show-ref", "--verify", "--quiet", ref]).status === 0;
        },
        lsRemoteHeads(url) {
            return must(["ls-remote", "--heads", url])
                .split("\n")
                .map((l) => l.match(/refs\/heads\/(.+)$/)?.[1] ?? "")
                .filter((n) => n.length > 0);
        },
        defaultBranch(url) {
            const r = runGit(["ls-remote", "--symref", url, "HEAD"]);
            if (r.status !== 0)
                return null;
            return r.stdout.match(/^ref:\s+refs\/heads\/(\S+)\s+HEAD/m)?.[1] ?? null;
        },
        revParse(repoDir, rev) {
            const r = runGit(["-C", repoDir, "rev-parse", "--verify", "--quiet", rev]);
            return r.status === 0 ? r.stdout.trim() : null;
        },
        currentBranch(repoDir) {
            return must(["-C", repoDir, "rev-parse", "--abbrev-ref", "HEAD"]).trim();
        },
        isAncestor(repoDir, ancestor, descendant) {
            return runGit(["-C", repoDir, "merge-base", "--is-ancestor", ancestor, descendant]).status === 0;
        },
        isClean(repoDir) {
            const r = runGit(["-C", repoDir, "status", "--porcelain"]);
            return r.status === 0 && r.stdout.trim() === "";
        },
        remoteBranchesMatching(repoDir, remote, pattern) {
            const r = runGit(["-C", repoDir, "ls-remote", "--heads", remote, pattern]);
            if (r.status !== 0)
                return [];
            return r.stdout
                .split("\n")
                .map((l) => l.match(/refs\/heads\/(.+)$/)?.[1] ?? "")
                .filter((n) => n.length > 0);
        },
        addPath(repoDir, pathspec) {
            must(["-C", repoDir, "add", pathspec]);
        },
        commit(repoDir, message) {
            must(["-C", repoDir, "commit", "-m", message]);
        },
        resetHard(repoDir, sha) {
            must(["-C", repoDir, "reset", "--hard", sha]);
        },
        cleanUntracked(repoDir, pathspec) {
            must(["-C", repoDir, "clean", "-fd", pathspec]);
        },
        worktreeAdd(baseRepo, newBranch, worktreePath, startPoint) {
            must(["-C", baseRepo, "worktree", "add", "-b", newBranch, worktreePath, startPoint]);
        },
        worktreeRemove(baseRepo, worktreePath) {
            const r = runGit(["-C", baseRepo, "worktree", "remove", "--force", worktreePath]);
            if (r.status !== 0) {
                // Fallback: rm the tree, then prune the base's worktree registry.
                try {
                    fs.rmSync(worktreePath, { recursive: true, force: true });
                }
                catch {
                    /* best-effort */
                }
                runGit(["-C", baseRepo, "worktree", "prune"]);
            }
        },
        branchDelete(repoDir, branch) {
            must(["-C", repoDir, "branch", "-D", branch]);
        },
        push(repoDir, remote, branch, opts) {
            const up = opts?.setUpstream ? ["-u"] : [];
            must(["-C", repoDir, "push", ...up, remote, branch]);
        },
        pushDelete(repoDir, remote, branch) {
            must(["-C", repoDir, "push", remote, "--delete", branch]);
        },
        clone(url, dest) {
            must(["-c", "http.postBuffer=524288000", "clone", url, dest]);
        },
        fetch(repoDir, remote, ref) {
            runGit(["-C", repoDir, "fetch", remote, ...(ref ? [ref] : [])]); // best-effort
        },
        setIdentity(repoDir, identity) {
            if (identity.name)
                must(["-C", repoDir, "config", "user.name", identity.name]);
            if (identity.email)
                must(["-C", repoDir, "config", "user.email", identity.email]);
        },
        checkout(repoDir, branch) {
            must(["-C", repoDir, "checkout", branch]);
        },
        checkoutNew(repoDir, branch) {
            must(["-C", repoDir, "checkout", "-b", branch]);
        },
        mergeNoEdit(repoDir, from) {
            return runGit(["-C", repoDir, "merge", "--no-edit", from]).status === 0 ? "merged" : "conflict";
        },
        tag(repoDir, name) {
            must(["-C", repoDir, "tag", name]);
        },
    };
}
/** The real filesystem probe. */
export const nodeFsProbe = {
    pathExists: (p) => fs.existsSync(p),
};

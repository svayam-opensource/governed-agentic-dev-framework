// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * Pure repo-URL helpers (SDD Part B, seed Phase C). Mirrors lib.sh `get_repo_name`
 * (`basename <url> .git`) and `base_clone_dir` (`<agentWorkRoot>/.bases/<name>` —
 * the ADR-0001 shared base clone, one per repo, project branches as worktrees).
 */
import * as path from "node:path";
/** The repo name from a clone URL: last path segment, minus a trailing `.git`. */
export function repoNameFromUrl(url) {
    const trimmed = url.replace(/\/+$/, "");
    const last = trimmed.split(/[/:]/).pop() ?? trimmed;
    return last.replace(/\.git$/, "");
}
/** The shared base-clone dir for a repo: `<agentWorkRoot>/.bases/<repoName>`. */
export function baseCloneDir(agentWorkRoot, url) {
    return path.join(agentWorkRoot, ".bases", repoNameFromUrl(url));
}

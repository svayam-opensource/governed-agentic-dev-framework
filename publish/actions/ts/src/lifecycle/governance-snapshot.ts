// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * THE GOVERNING FILES, PUT WHERE THE AGENT CAN READ THEM (PRJ-121, 2026-09-22).
 *
 * The session-start protocol sends the agent to two files that must come from the DEFAULT branch (POL-086a):
 * `org-config.yaml` and the governance policy. It used to point at the default-branch clone,
 * `~/.gov/<slug>/gov_repo` — which is OUTSIDE the project folder the agent is started in and, for an agent
 * that sandboxes its reads to that folder, off limits. On a walk, IBM Bob's `read_file` on
 * `gov_repo/org-config.yaml` failed, and Bob got the file by running `cat` through its shell: the protocol
 * worked only by going around the agent's own safety rule.
 *
 * So gov copies them INTO the project folder, at every launch, beside the harness file it already places there.
 * The Policy Owner's suggestion, and the reason this reads through the PROJECT'S OWN worktree: that worktree
 * and gov_repo are one repository, so `git show <default>:<file>` reads the default branch's version from inside
 * the project — no branch is switched (the worktree is the project's working copy, on the project branch), and
 * nothing outside the folder is needed.
 *
 * A COPY, deliberately, not a symlink. A symlink was tested and Bob follows it — but it points at gov_repo,
 * which stays writable, so an agent "tidying" its copy would be editing the governance clone itself. A copy is
 * read-only by construction (and 0444 besides), and is stamped with the commit it came from, so "read from the
 * default branch" is something the manifest can show rather than assert.
 *
 * ALL OR NOTHING. If any file cannot be read at the ref, nothing is written and the caller falls back to the old
 * paths. A half snapshot would be two governing files from two sources, which is worse than either.
 */

/** Paths inside the governance repo that govern a session. */
export const GOVERNING_FILES = ["org-config.yaml", "framework/policies/framework-policy.md"] as const;

export interface GovSnapshot {
  /** The folder the files were written to: `<project>/.gov/governance`. */
  readonly dir: string;
  /** Written file names, in GOVERNING_FILES order. */
  readonly files: readonly string[];
  /** `<ref>@<sha7>` — what the agent is told, and what the manifest can quote. */
  readonly source: string;
}

export interface SnapshotPorts {
  /** Run git with these args; stdout on success, null on failure. */
  readonly git: (args: readonly string[]) => string | null;
  /** Replace a file with this content at this mode (it may exist, read-only, from the last launch). */
  readonly write: (path: string, content: string, mode: number) => void;
  readonly now: () => Date;
}

const basename = (p: string): string => p.slice(p.lastIndexOf("/") + 1);

export function snapshotGovernance(
  ports: SnapshotPorts, projectDir: string, workspaceRepo: string, defaultBranch: string,
): GovSnapshot | null {
  const worktree = `${projectDir}/${workspaceRepo}`;
  // The local default branch first — it is what gov_repo holds, and what the agent read before. The remote-
  // tracking one next, for a checkout that has only that.
  const ref = [defaultBranch, `origin/${defaultBranch}`]
    .find((r) => ports.git(["-C", worktree, "rev-parse", "--verify", "--quiet", `${r}^{commit}`]) !== null);
  if (!ref) return null;
  const sha = ports.git(["-C", worktree, "rev-parse", "--short=7", `${ref}^{commit}`])?.trim();
  if (!sha) return null;

  const contents: string[] = [];
  for (const f of GOVERNING_FILES) {
    const text = ports.git(["-C", worktree, "show", `${ref}:${f}`]);
    if (text === null) return null;            // all or nothing
    contents.push(text);
  }

  const dir = `${projectDir}/.gov/governance`;
  GOVERNING_FILES.forEach((f, i) => ports.write(`${dir}/${basename(f)}`, contents[i]!, 0o444));
  const source = `${ref}@${sha}`;
  ports.write(`${dir}/SOURCE`, [
    `${source}`,
    `copied ${ports.now().toISOString()} by gov, at the start of this session`,
    `read with: git -C ${worktree} show ${ref}:<file>`,
    "the DEFAULT branch — the only branch that governs (POL-086a). Read-only: a change to governance is",
    "proposed with `gov knowledge propose`, never made here.",
    "",
  ].join("\n"), 0o444);
  return { dir, files: GOVERNING_FILES.map(basename), source };
}

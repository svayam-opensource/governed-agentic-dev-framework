// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * Leftover-state detection for seed (SDD Part B) — pure logic over the `Vcs` +
 * `FsProbe` ports. A prior failed seed can leave a local/remote project branch,
 * the per-project workspace, and a home stub folder; seed detects them so the
 * caller can offer cleanup. Each artifact carries the structured data the
 * cleanup step (slice 4) needs to reverse it.
 */
import * as path from "node:path";
import type { FsProbe, Vcs } from "./vcs.js";

/** The paths + branch a seed run touches (home stays on the default branch). */
export interface SeedPaths {
  /** The gov home clone (REPO_ROOT) — stays on the default branch. */
  readonly govHome: string;
  /** The per-project workspace root: `<agentWorkRoot>/<projectId>`. */
  readonly projectWorkRoot: string;
  /** The home stub folder on the default branch: `<govHome>/projects/<projectId>`. */
  readonly homeStub: string;
  readonly branch: string;
  readonly remote: string;
}

/** Compose the seed paths (pure) from an already-expanded agent work root. */
export function seedPathsFor(input: {
  govHome: string;
  agentWorkRoot: string;
  projectId: string;
  branch: string;
  remote?: string;
}): SeedPaths {
  return {
    govHome: input.govHome,
    projectWorkRoot: path.join(input.agentWorkRoot, input.projectId),
    homeStub: path.join(input.govHome, "projects", input.projectId),
    branch: input.branch,
    remote: input.remote ?? "origin",
  };
}

export type LeftoverKind = "local-branch" | "remote-branch" | "workspace-dir" | "home-stub";

/** One stale artifact from a prior failed seed, with cleanup data. */
export interface LeftoverArtifact {
  readonly kind: LeftoverKind;
  readonly detail: string;
  readonly branch?: string;
  readonly repoDir?: string;
  readonly remote?: string;
  readonly path?: string;
}

/**
 * Detect leftover artifacts for a to-be-seeded project. Order matches seed.sh.
 * NOTE: the legacy bash also checked a `registry.yaml` entry — **dropped** per
 * registry-elimination (the board number is the allocator; seed never writes the
 * registry). See SDD-012 / SDD-041.
 */
export function detectLeftovers(env: { vcs: Vcs; fs: FsProbe }, p: SeedPaths): LeftoverArtifact[] {
  const out: LeftoverArtifact[] = [];
  if (env.vcs.localBranchExists(p.govHome, p.branch)) {
    out.push({
      kind: "local-branch",
      detail: `local branch '${p.branch}' in the gov home`,
      branch: p.branch,
      repoDir: p.govHome,
    });
  }
  if (env.vcs.remoteBranchExists(p.govHome, p.remote, p.branch)) {
    out.push({
      kind: "remote-branch",
      detail: `remote branch '${p.remote}/${p.branch}'`,
      branch: p.branch,
      repoDir: p.govHome,
      remote: p.remote,
    });
  }
  if (env.fs.pathExists(p.projectWorkRoot)) {
    out.push({
      kind: "workspace-dir",
      detail: `per-project workspace at '${p.projectWorkRoot}'`,
      path: p.projectWorkRoot,
    });
  }
  if (env.fs.pathExists(p.homeStub)) {
    out.push({
      kind: "home-stub",
      detail: `home stub folder 'projects/${path.basename(p.homeStub)}/' on the default branch`,
      path: p.homeStub,
    });
  }
  return out;
}

/** Human summary of detected leftovers (empty string when there are none). */
export function leftoversMessage(leftovers: readonly LeftoverArtifact[]): string {
  if (leftovers.length === 0) return "";
  return (
    "Detected leftover state from a previous failed run:\n" +
    leftovers.map((l) => `    - ${l.detail}`).join("\n")
  );
}

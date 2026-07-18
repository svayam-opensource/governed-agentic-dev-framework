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
export declare function seedPathsFor(input: {
    govHome: string;
    agentWorkRoot: string;
    projectId: string;
    branch: string;
    remote?: string;
}): SeedPaths;
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
export declare function detectLeftovers(env: {
    vcs: Vcs;
    fs: FsProbe;
}, p: SeedPaths): LeftoverArtifact[];
/** Human summary of detected leftovers (empty string when there are none). */
export declare function leftoversMessage(leftovers: readonly LeftoverArtifact[]): string;

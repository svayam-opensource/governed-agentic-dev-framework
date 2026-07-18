import { type RollbackFailure } from "./transaction.js";
import { type Board } from "./board.js";
import type { Vcs } from "./vcs.js";
import type { Fs } from "./fs-io.js";
import type { AnchorCreator } from "./anchor.js";
import { type LeftoverArtifact } from "./leftover.js";
/** Org-config-derived settings for a seed run. */
export interface SeedConfig {
    readonly govHome: string;
    readonly workspaceRepo: string;
    readonly agentWorkRoot: string;
    readonly defaultBranch: string;
    readonly defaultCodeBranch: string;
    readonly githubOrg: string;
    /** Token → value for tool-file substitution (e.g. ORG_NAME). */
    readonly orgTokens: Readonly<Record<string, string>>;
    /** Tool files (paths under `framework/`) to token-substitute into the project. */
    readonly toolFiles?: readonly string[];
    readonly remote?: string;
}
/** Per-run inputs. */
export interface SeedInput {
    readonly boardUrl: string;
    readonly assignee: string;
    readonly seededBy: string;
    /** YYYY-MM-DD (injected — no Date in pure code). */
    readonly today: string;
    readonly identity?: {
        name?: string;
        email?: string;
    };
    /** gh login to assign the anchor issue to. */
    readonly seederLogin?: string | null;
    /** repo url → chosen base branch (else defaultCodeBranch). */
    readonly repoBases?: Readonly<Record<string, string>>;
    /** Frozen legacy branch overrides for grandfathered ids. */
    readonly legacyBranches?: Readonly<Record<string, string>>;
}
/** Ports + effects the orchestrator drives. */
export interface SeedDeps {
    readonly board: Board;
    readonly vcs: Vcs;
    readonly fs: Fs;
    readonly anchor: AnchorCreator;
    readonly cloneRepo: (url: string, dest: string) => void;
    readonly log?: (msg: string) => void;
}
export interface SeedSuccess {
    readonly ok: true;
    readonly projectId: string;
    readonly branch: string;
    readonly projectWorkRoot: string;
    readonly orgGovClone: string;
    readonly repos: ReadonlyArray<{
        name: string;
        url: string;
        repoDir: string;
    }>;
    readonly anchorRef: string | null;
}
export type SeedResult = SeedSuccess | {
    readonly ok: false;
    readonly code: number;
    readonly reason: string;
    readonly message: string;
    readonly leftovers?: readonly LeftoverArtifact[];
    readonly rollbackFailures?: readonly RollbackFailure[];
};
/** Seed a project workspace from its GitHub Project board. */
export declare function seed(deps: SeedDeps, config: SeedConfig, input: SeedInput): SeedResult;

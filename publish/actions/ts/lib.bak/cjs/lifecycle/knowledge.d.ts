/**
 * `knowledge` (SDD Part C, cmd_knowledge / propose-knowledge.sh) — the org-
 * knowledge proposal lifecycle: a `knowledge-<slug>` branch on the gov repo →
 * PR → archive. Org knowledge is read-only during a project (C01); this is the
 * sanctioned way to change it (branch + review). Pure over Vcs + Pulls.
 */
import type { Vcs } from "./vcs.js";
import type { Pulls } from "./pulls.js";
export interface KnowledgeConfig {
    readonly defaultBranch: string;
    readonly githubOrg: string;
    readonly workspaceRepo: string;
    readonly remote?: string;
}
export type KnowledgeResult = {
    readonly ok: true;
    readonly lines: readonly string[];
} | {
    readonly ok: false;
    readonly code: number;
    readonly message: string;
};
/** The branch name for a knowledge proposal. */
export declare function knowledgeBranch(slug: string): string;
/** Create + push a `knowledge-<slug>` proposal branch off the default branch. */
export declare function proposeKnowledge(vcs: Vcs, config: KnowledgeConfig, home: string, slug: string): KnowledgeResult;
/** Open a PR for a `knowledge-<slug>` branch → the default branch. */
export declare function submitKnowledge(pulls: Pulls, config: KnowledgeConfig, slug: string, description: string): KnowledgeResult;
/** Archive a merged `knowledge-<slug>` branch (tag archive/<branch> + delete). */
export declare function archiveKnowledge(vcs: Vcs, config: KnowledgeConfig, home: string, slug: string): KnowledgeResult;

// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * VcsPort — the code HOST: repositories, branches as the host sees them, branch rules, and the org-level things a
 * host keeps (Apps, org secrets). LOCAL git is not here: commit, push and fetch stay in `lifecycle/vcs.ts`.
 *
 * THIS IS A FIRST SLICE (PRJ-121 intent 02, E07 `gov evidence enable`), cut in the layout intent 03 (D7, spec §6)
 * gives the full port: `repo` and `branch` have intent 03's exact shapes; the rest is only what turning evidence on
 * needs. Intent 03 completes the interface (change requests, reviews, required checks, identity) — the same way
 * `ports/work-tracker.ts` began as intent 05's slice. Every call returns a {@link Result}: a thing that is simply
 * absent (a branch that does not exist) is a successful `null`, so a caller can tell "no" from "could not ask".
 */
import type { Result } from "./result.js";

/** A repository on the host. */
export interface RepoRef { readonly owner: string; readonly name: string }

export interface RepoInfo {
  readonly defaultBranch: string;
  /** Where a person opens it. */
  readonly url: string;
  readonly visibility: "public" | "private" | "internal";
}

export interface BranchInfo {
  readonly name: string;
  /** The commit the branch points at. */
  readonly sha: string;
  /** The host enforces rules on it (protection or a ruleset). */
  readonly protected: boolean;
}

/** One file of a new branch's first commit. */
export interface NewFile { readonly path: string; readonly text: string }

/**
 * A branch ruleset, in the host's terms. GitHub's ruleset API takes this object as it is: `non_fast_forward` refuses
 * a force push, `deletion` refuses deleting the branch. No bypass actor: nobody — an admin included — may do either.
 */
export interface BranchRuleset {
  readonly name: string;
  readonly target: "branch";
  readonly enforcement: "active";
  readonly conditions: { readonly ref_name: { readonly include: readonly string[]; readonly exclude: readonly string[] } };
  readonly rules: readonly { readonly type: "non_fast_forward" | "deletion" }[];
  readonly bypass_actors: readonly never[];
}

export interface RulesetSummary { readonly id: number; readonly name: string }

/** What the host hands back when an App made from a manifest is converted: the private key is in `pem`. */
export interface NewApp { readonly slug: string; readonly clientId: string; readonly pem: string }

export interface VcsPort {
  repo(r: RepoRef): Promise<Result<RepoInfo>>;
  /** `ok(null)` when the branch does not exist. */
  branch(r: RepoRef, name: string): Promise<Result<BranchInfo | null>>;
  /**
   * Create `name` as an ORPHAN branch: one commit with no parent holding exactly `files`. Never moves another branch.
   * Fails when the branch already exists.
   */
  createOrphanBranch(r: RepoRef, name: string, files: readonly NewFile[], message: string): Promise<Result<{ readonly sha: string }>>;
  rulesets(r: RepoRef): Promise<Result<RulesetSummary[]>>;
  createRuleset(r: RepoRef, ruleset: BranchRuleset): Promise<Result<{ readonly id: number }>>;
  /** Does an App with this slug exist? */
  appExists(slug: string): Promise<Result<boolean>>;
  /** Exchange an App-manifest flow's single-use code for the new App's identity and private key. */
  convertAppManifest(code: string): Promise<Result<NewApp>>;
  /** The names of the org's Actions secrets (never a value). */
  orgSecretNames(org: string): Promise<Result<string[]>>;
  /** Set an org Actions secret visible to all the org's repositories. The value never appears in an argument or a log. */
  setOrgSecret(org: string, name: string, value: string): Promise<Result<void>>;
}

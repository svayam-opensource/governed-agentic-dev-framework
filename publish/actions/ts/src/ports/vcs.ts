// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * VcsPort — the code HOST (PRJ-121 intent 03, D7, spec §6): repositories, branches as the host sees them, change
 * requests, their reviews, the checks a branch requires, and who gov is signed in as.
 *
 * LOCAL git is not here: commit, branch, push and fetch stay in `lifecycle/vcs.ts`, because git is the same on
 * every host. This port is what differs between GitHub, GitLab and Azure DevOps.
 *
 * Vendor-neutral words: a "change request" is a GitHub pull request or a GitLab merge request. Every call returns
 * a {@link Result}; a thing that is simply absent (a branch that does not exist) is a successful `null`, so a
 * caller can tell "no" from "could not ask".
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

export interface NewChangeRequest {
  readonly repo: RepoRef;
  /** The branch with the change. */
  readonly head: string;
  /** The branch it is to land on. */
  readonly base: string;
  readonly title: string;
  readonly body: string;
  /** Open it as a draft — not yet asking for review. */
  readonly draft?: boolean;
}

export interface ChangeRequestRef { readonly repo: RepoRef; readonly number: number }

export interface ChangeRequest {
  readonly ref: ChangeRequestRef;
  /** `merged` wins over `closed`: a merged change request is closed too, and merged is what a caller asks. */
  readonly state: "open" | "closed" | "merged";
  readonly merged: boolean;
  readonly draft: boolean;
  readonly head: string;
  readonly base: string;
  readonly title: string;
  readonly url: string;
}

/** A person or an automated account. Q2: an agent can write text; it cannot approve as a person. */
export type AccountKind = "human" | "bot";

export interface Review {
  /** The reviewer's login. */
  readonly by: string;
  readonly kind: AccountKind;
  readonly verdict: "approved" | "changes-requested" | "commented" | "dismissed" | "pending";
  /** When it was submitted (ISO 8601); "" for a review not yet submitted. */
  readonly at: string;
}

export interface Identity { readonly login: string; readonly kind: AccountKind }

export interface VcsPort {
  repo(r: RepoRef): Promise<Result<RepoInfo>>;
  /** `ok(null)` when the branch does not exist. */
  branch(r: RepoRef, name: string): Promise<Result<BranchInfo | null>>;
  openChangeRequest(cr: NewChangeRequest): Promise<Result<ChangeRequestRef>>;
  changeRequest(ref: ChangeRequestRef): Promise<Result<ChangeRequest>>;
  reviews(ref: ChangeRequestRef): Promise<Result<Review[]>>;
  /** The status checks that must pass before a change lands on `branch`; `[]` when none are required. */
  requiredChecks(r: RepoRef, branch: string): Promise<Result<string[]>>;
  /** Who gov is acting as on the host. */
  identity(): Promise<Result<Identity>>;
}

// ── Evidence administration (PRJ-121 intent 02, I02-E07) ──────────────────────────────────────────────────────
// What `gov evidence enable` needs from the host: an orphan evidence branch, its ruleset, the writer App and the
// org secrets. A separate port from {@link VcsPort} (the change-request side) so each adapter stays small; both
// share the repo/branch reads and the {@link Result} convention. Merged here from intent 02's first slice.

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

export interface VcsEvidencePort {
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

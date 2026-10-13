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

/**
 * Which change requests to list. Every field narrows; none → all of the repository's. `state`: `closed` means
 * closed WITHOUT merging (a merged one answers `merged`), `all` is every state (the default).
 */
export interface ChangeRequestQuery {
  readonly base?: string;
  readonly head?: string;
  readonly state?: "open" | "closed" | "merged" | "all";
}

export interface VcsPort {
  repo(r: RepoRef): Promise<Result<RepoInfo>>;
  /** `ok(null)` when the branch does not exist. */
  branch(r: RepoRef, name: string): Promise<Result<BranchInfo | null>>;
  openChangeRequest(cr: NewChangeRequest): Promise<Result<ChangeRequestRef>>;
  changeRequest(ref: ChangeRequestRef): Promise<Result<ChangeRequest>>;
  reviews(ref: ChangeRequestRef): Promise<Result<Review[]>>;
  /** The change requests matching `q`, newest first. `ok([])` when none match; a repository it cannot read fails. */
  changeRequests(r: RepoRef, q: ChangeRequestQuery): Promise<Result<ChangeRequest[]>>;
  /** The status checks that must pass before a change lands on `branch`; `[]` when none are required. */
  requiredChecks(r: RepoRef, branch: string): Promise<Result<string[]>>;
  /** Who gov is acting as on the host. */
  identity(): Promise<Result<Identity>>;
}

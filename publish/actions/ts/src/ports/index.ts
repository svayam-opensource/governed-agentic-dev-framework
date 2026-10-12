// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * THE NEUTRAL PORTS (PRJ-121 intent 03, D7; contract M4).
 *
 * gov's new modules (signal, autorun, intent, project, skills) talk to the code host, the work tracker and the CI
 * through these interfaces, never through `gh` — an `eslint` rule holds them to it (`eslint-rules/no-direct-gh.js`).
 * The words are vendor-neutral: change request, review, required check, project, item. GitHub is one adapter
 * (`src/adapters/github/`); `memory` is the reference adapter tests run against (`src/adapters/memory/`); which
 * one answers is `adapters:` in org-config.yaml (`src/adapters/registry.ts`).
 *
 * Learned from gov-cicd (`src/ports.ts`, `adapters/registry.ts`), with one difference: every call returns a
 * {@link Result} the caller must handle.
 */
export * from "./result.js";
import type { CiIdentityPort } from "./ci-identity.js";
import type { VcsPort } from "./vcs.js";
import type { WorkTrackerPort } from "./work-tracker.js";
export type {
  VcsPort, RepoRef, RepoInfo, BranchInfo, NewChangeRequest, ChangeRequestRef, ChangeRequest, Review, Identity, AccountKind,
} from "./vcs.js";
export type { CiIdentityPort, CiClaims } from "./ci-identity.js";
export type {
  WorkTrackerPort, ProjectRef, ItemRef, Project, Item, NewItem, WorkState, LinkKind, LinkOutcome, SearchQuery, BoardWriter,
} from "./work-tracker.js";

/**
 * The ports, by name — the list a conformance suite walks. The yaml key for each is {@link PORT_CONFIG_KEYS}.
 */
export const PORT_NAMES = ["workTracker", "vcs", "ciIdentity"] as const;
export type PortName = (typeof PORT_NAMES)[number];

/** Each port's key under `adapters:` in org-config.yaml (the file's own snake_case). */
export const PORT_CONFIG_KEYS: Readonly<Record<PortName, string>> = {
  workTracker: "work_tracker",
  vcs: "vcs",
  ciIdentity: "ci_identity",
};

/** The interface behind each port name; the registry and every adapter table are typed from here. */
export interface PortTypes {
  /** WorkTrackerPort — `./work-tracker.ts` (plan 05 T04 started it; plan 03 L02 completed it, setStatus → setState). */
  workTracker: WorkTrackerPort;
  /** VcsPort — `./vcs.ts` (plan 03 L03): the code HOST. Local git stays in `lifecycle/vcs.ts`. */
  vcs: VcsPort;
  /** CiIdentityPort — `./ci-identity.ts` (plan 03 L04). */
  ciIdentity: CiIdentityPort;
}

/** One adapter per port, as the registry builds them. */
export type Ports = { readonly [K in PortName]: PortTypes[K] };

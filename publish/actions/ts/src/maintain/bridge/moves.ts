// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
// bridge: deleted in D01 (PRJ-121 intent 01, spec §4.1)
/**
 * COMMIT 2: THE ORGANIZATION'S OWN DOCUMENTS MOVE (PRJ-121 intent 01, spec §4.2's table; ruling Q3).
 *
 * A layout-1.0 repository keeps the org's policies under knowledge/policies/. The 2.0 tree keeps them under
 * policies/<phase>/. Each move is a STRAIGHT move: the bytes the org has, at the new path — the framework owns where a
 * file lives, never what the org wrote in it. Path mentions inside the moved prose are rewritten only as a PROPOSAL,
 * in commit 4.
 *
 * Only the documents the table names move. Everything else under knowledge/policies/ — the knowledge organization
 * standard (the org's knowledge tree, T14), proposals, specs, use cases, mandates, patterns, READMEs — is left exactly
 * where it is and named in the PR body (Q3). The framework's exception templates are retired by fingerprint
 * (fingerprints.ts), beside the records that move here.
 */
import { collapseDirs, type LeftInPlace } from "../upgrade-commits.js";
import type { PlanAction } from "../upgrade-sync.js";

export interface BridgeMove { readonly from: string; readonly to: string }

/** The documents spec §4.2 moves, one by one. Destinations: policies/common/ is §2's; build/ and deploy/ are the phase folders. */
export const BRIDGE_MOVES: readonly BridgeMove[] = [
  { from: "knowledge/policies/data-classification.md", to: "policies/common/data-classification.md" },
  { from: "knowledge/policies/api-development-policy.md", to: "policies/build/api-development-policy.md" },
  { from: "knowledge/policies/platform-host-config-and-cicd-conventions.md", to: "policies/deploy/platform-host-config-and-cicd-conventions.md" },
];

const EXCEPTIONS = "knowledge/policies/exceptions/";
/** An approved exception record: `exceptions/<domain>/<record>.md`, never a README or the framework's TEMPLATE.md. */
const isExceptionRecord = (p: string): boolean => {
  if (!p.startsWith(EXCEPTIONS) || !p.endsWith(".md")) return false;
  const rest = p.slice(EXCEPTIONS.length).split("/");
  return rest.length === 2 && !/^(README|TEMPLATE)\.md$/i.test(rest[1]!);
};

/** The moves this repository needs, and the ones that cannot run because their destination is already there. */
export function bridgeMoves(files: readonly string[]): { moves: BridgeMove[]; blocked: LeftInPlace[] } {
  const present = new Set(files);
  const wanted = [
    ...BRIDGE_MOVES.filter((m) => present.has(m.from)),
    ...files.filter(isExceptionRecord).map((from) => ({ from, to: `policies/exceptions/${from.slice(EXCEPTIONS.length)}` })),
  ];
  const moves: BridgeMove[] = [];
  const blocked: LeftInPlace[] = [];
  for (const m of wanted) {
    if (present.has(m.to)) blocked.push({ path: m.from, why: `${m.to} already exists — not moved; merge the two by hand` });
    else moves.push(m);
  }
  return { moves, blocked };
}

/**
 * Commit 2's planned moves, and what is left under knowledge/policies/ once every bridge step has planned: `taken` is
 * what the other steps retire or carry (fingerprinted templates, migrated files), so it is not "left".
 */
export function movePlan(files: readonly string[], taken: ReadonlySet<string>): { actions: PlanAction[]; leftInPlace: LeftInPlace[] } {
  const { moves, blocked } = bridgeMoves(files);
  const moved = new Set(moves.map((m) => m.from));
  const blockedSet = new Set(blocked.map((b) => b.path));
  const left = files.filter((f) => f.startsWith("knowledge/policies/") && !moved.has(f) && !taken.has(f) && !blockedSet.has(f));
  return {
    actions: moves.map((m) => ({ kind: "move" as const, from: m.from, dst: m.to, detail: "the org's own document, moved as it stands" })),
    leftInPlace: [
      ...blocked,
      ...collapseDirs(left, files).map((p) => ({ path: p, why: "the org's own — the bridge does not move it (spec §4.2); left exactly where it is" })),
    ],
  };
}

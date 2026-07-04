// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * `publish` (SDD Part E, SDD-050) — the PRE-PUBLISH GATE, not the publish itself.
 * SDD-050: never `npm publish` by hand — real publish is the governed Jenkins
 * pipeline. This command runs the readiness gate (version-sync must pass) and
 * reports whether the package is publishable. Pure over the Fs port + validators.
 */
import type { Fs } from "../lifecycle/fs-io.js";
import { checkVersionSync } from "../governance/version-sync.js";

export interface PublishGate {
  readonly ok: boolean;
  readonly blockers: readonly string[];
}

export function publishGate(fs: Fs, repoRoot: string): PublishGate {
  const vs = checkVersionSync({ fs, repoRoot });
  const blockers = vs.ok ? [] : vs.errors.map((e) => `version-sync: ${e}`);
  return { ok: blockers.length === 0, blockers };
}

export function formatPublishGate(g: PublishGate): string[] {
  return g.ok
    ? ["publish gate: PASS — ready to publish via the governed Jenkins pipeline (never `npm publish` by hand)."]
    : ["publish gate: BLOCKED —", ...g.blockers.map((b) => `  - ${b}`)];
}

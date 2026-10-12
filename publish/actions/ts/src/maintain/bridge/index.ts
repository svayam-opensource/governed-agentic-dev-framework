// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
// bridge: deleted in D01 (PRJ-121 intent 01, spec §4.1)
/**
 * THE BRIDGE — every migration to the 2.0 layout, in one pre-release, deleted by the next (spec 01 §4.1, Q1).
 *
 * `gov upgrade` runs it as an UpgradeExtension: its planned actions are shown by a dry run and applied in their commit
 * of the upgrade PR; its proposals are commit 4. On a repository not on the 1.0 layout it does nothing.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import type { LeftInPlace, UpgradeExtension } from "../upgrade-commits.js";
import { contentLayoutOf, type PlanAction, type UpgradePlan } from "../upgrade-sync.js";
import { matchFingerprints } from "./fingerprints.js";
import { movePlan } from "./moves.js";

/** Every file under `root` (relative), skipping .git and node_modules. */
function filesOf(root: string, rel = ""): string[] {
  return fs.readdirSync(path.join(root, rel)).flatMap((n) => {
    if (n === ".git" || n === "node_modules") return [];
    const r = rel ? `${rel}/${n}` : n;
    return fs.statSync(path.join(root, r)).isDirectory() ? filesOf(root, r) : [r];
  });
}

const reader = (dir: string) => (rel: string): string | null => {
  const p = path.join(dir, rel);
  return fs.existsSync(p) && fs.statSync(p).isFile() ? fs.readFileSync(p, "utf8") : null;
};

/** Commit 1 (and the templates of commit 2): the old world's framework files, retired by fingerprint (Q3). */
export function fingerprintPlan(read: (rel: string) => string | null, plan: UpgradePlan): { actions: PlanAction[]; leftInPlace: LeftInPlace[] } {
  const planned = new Set(plan.actions.filter((a) => a.kind === "retire").map((a) => a.dst));
  const m = matchFingerprints(read);
  return {
    actions: m.retire.filter((f) => !planned.has(f.path)).map((f) => ({ kind: "retire" as const, dst: f.path, commit: f.commit, detail: "the framework's own file from the 1.0 layout (its exact bytes)" })),
    leftInPlace: m.changed.map((p) => ({ path: p, why: "named like a 1.0 framework file, but not its body — yours, kept" })),
  };
}

export const BRIDGE: UpgradeExtension = {
  plan: (adopterDir, _contentDir, plan) => {
    const read = reader(adopterDir);
    if (contentLayoutOf((rel) => fs.existsSync(path.join(adopterDir, rel))) !== "layout-1.0") return { actions: [], leftInPlace: [] };
    const files = filesOf(adopterDir);
    const fp = fingerprintPlan(read, plan);
    const mv = movePlan(files, new Set(fp.actions.map((a) => a.dst)));
    return { actions: [...fp.actions, ...mv.actions], leftInPlace: [...fp.leftInPlace, ...mv.leftInPlace] };
  },
};

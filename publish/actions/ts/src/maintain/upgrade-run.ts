// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * `gov upgrade --from <content>` runner — the fs-backed shell around the pure
 * overlay-sync engine. Walks the content source + the adopter workspace, plans
 * the migration, and (with --apply) writes it. Dry-run by default.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { parseManifest, expandEntries, planUpgrade, applyUpgrade, formatPlan } from "./upgrade-sync.js";

const SKIP = new Set([".git", "node_modules"]);

/** Relative file paths under `root` (skips .git / node_modules). */
function walk(root: string, rel = ""): string[] {
  const abs = path.join(root, rel);
  if (!fs.existsSync(abs)) return [];
  const out: string[] = [];
  for (const name of fs.readdirSync(abs)) {
    if (SKIP.has(name)) continue;
    const childRel = rel ? `${rel}/${name}` : name;
    const st = fs.statSync(path.join(root, childRel));
    if (st.isDirectory()) out.push(...walk(root, childRel));
    else out.push(childRel);
  }
  return out;
}

export interface UpgradeSyncResult { readonly code: number; readonly lines: readonly string[]; }

export function runUpgradeSync(contentDir: string, adopterDir: string, opts: { apply: boolean }): UpgradeSyncResult {
  const manifestPath = path.join(contentDir, "MANIFEST.yaml");
  if (!fs.existsSync(manifestPath)) return { code: 1, lines: [`gov upgrade: no MANIFEST.yaml under ${contentDir}`] };

  const manifest = parseManifest(fs.readFileSync(manifestPath, "utf8"));
  const entries = expandEntries(manifest, walk(contentDir));
  const readContent = (rel: string): string | null => {
    const p = path.join(contentDir, rel);
    return fs.existsSync(p) && fs.statSync(p).isFile() ? fs.readFileSync(p, "utf8") : null;
  };
  const readAdopter = (rel: string): string | null => {
    const p = path.join(adopterDir, rel);
    return fs.existsSync(p) && fs.statSync(p).isFile() ? fs.readFileSync(p, "utf8") : null;
  };
  const plan = planUpgrade(entries, { readContent, readAdopter, adopterPaths: () => walk(adopterDir) });

  if (!opts.apply) {
    return { code: 0, lines: ["gov upgrade — DRY RUN (no changes written):", "", ...formatPlan(plan), "", "Re-run with --apply to write these changes."] };
  }

  const res = applyUpgrade(plan, {
    readContent,
    readAdopter,
    writeAdopter: (rel, text) => {
      const p = path.join(adopterDir, rel);
      fs.mkdirSync(path.dirname(p), { recursive: true });
      fs.writeFileSync(p, text);
    },
    removeAdopter: (rel) => fs.rmSync(path.join(adopterDir, rel.replace(/\/$/, "")), { recursive: true, force: true }),
  });
  return {
    code: 0,
    lines: [
      `gov upgrade — applied ${res.applied.length} change(s)${res.skipped.length ? `, skipped ${res.skipped.length} conflict(s) for review:` : "."}`,
      ...res.skipped.map((s) => `  ! ${s} (org-customized — reconcile by hand)`),
    ],
  };
}

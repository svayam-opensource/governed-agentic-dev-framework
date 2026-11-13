// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * The door URL and the set of docs people read (#181, plan 04 T07). Shared by the hermetic doc test
 * (test/content/door-docs.test.ts) and the network link check (scripts/door-link-check.mjs), so the two
 * cannot disagree about which URL is the door or which files are people-facing.
 *
 * DOOR_URL is gov.svayamtech.com by ruling Q2 A. When gov.svayam.ai is live with redirects (P2 B,
 * 910-GOV-CICD#273) this constant and the docs change in one commit.
 */
import * as fs from "node:fs";
import * as path from "node:path";

export const DOOR_URL = "https://gov.svayamtech.com";

/** Not people-facing: history (CHANGELOG), the frozen CLI's own tree, build output, fixtures. */
const SKIP_DIRS = new Set(["node_modules", ".git", "deprecated", "fixtures", "dist", "coverage"]);

function walk(root, rel, out, keep) {
  for (const e of fs.readdirSync(path.join(root, rel), { withFileTypes: true })) {
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) walk(root, r, out, keep); }
    else if (keep(r)) out.push(r);
  }
}

/**
 * Repo-relative paths of every doc a person reads to install or use gov: the root README and
 * CONTRIBUTING, docs/, the npm README, and the content an adopter's repo is seeded with. CHANGELOG.md
 * is history and is left out; so is site/README.md, the maintainers' note on the DNS plan, which has to
 * name the planned host. The install PAGE is no longer here: since PRJ-121 IS-E2 the install host serves
 * scripts only and `/` redirects to the portal's /install, which lives in Svayamtech/912-SVM-LIB-UI.
 */
export function peopleFacingDocs(root) {
  const out = [];
  for (const f of ["README.md", "CONTRIBUTING.md", "publish/actions/ts/README.md"]) {
    if (fs.existsSync(path.join(root, f))) out.push(f);
  }
  walk(root, "docs", out, (r) => r.endsWith(".md"));
  walk(root, "publish/content", out, (r) => r.endsWith(".md"));
  return out.sort();
}

// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * ADOPTION WALK #6 + #7 (2026-10-07).
 *
 * #6 — the closing "Read these, in this order" list printed descriptions with no path above them ("who is accountable
 * for what…", "what may never leave your organization"): the documents they described were renamed or merged by the
 * split, and the paths went with them. Every path the closing screens print must exist in what setup seeds, and every
 * description must sit under a path.
 *
 * #7 — option B told the admin to edit on main, then commit and push. Under the rule model that is a GOV-FRM-040
 * violation (every change lands by an approved pull request); it says so, and recommends C.
 */
import { expect } from "chai";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { adopterNextSteps, joinerNextSteps } from "../../src/cli/next-steps.js";
import { expandEntries, parseManifest } from "../../src/maintain/upgrade-sync.js";
import { starterProject } from "../../src/lifecycle/starter-project.js";

const CONTENT = fileURLToPath(new URL("../../../../content/", import.meta.url));
const HOME = "/home/t/.gov/geneva/gov_repo";
const F = { orgSlug: "GENEVA", githubOrg: "svm-geneva", workspaceRepo: "svm-geneva-gov", workspacePath: HOME };

function contentFiles(dir: string, rel = ""): string[] {
  return fs.readdirSync(path.join(dir, rel), { withFileTypes: true }).flatMap((e) => {
    const r = rel ? `${rel}/${e.name}` : e.name;
    return e.isDirectory() ? contentFiles(dir, r) : [r];
  });
}
/** Every path setup seeds into a new governance repository (the MANIFEST's destinations). */
const SEEDED = new Set(expandEntries(parseManifest(fs.readFileSync(path.join(CONTENT, "MANIFEST.yaml"), "utf8")), contentFiles(CONTENT)).map((e) => e.dst));

/** The repo-relative paths a closing screen prints under the workspace. */
const printedPaths = (lines: readonly string[]): string[] =>
  lines.flatMap((l) => [...l.matchAll(new RegExp(`${HOME.replace(/[.]/g, "\\.")}/(\\S+)`, "g"))].map((m) => m[1]!.replace(/[.,;:)]+$/, "")));

describe("gov-work — the closing screens point at documents that exist (walk #6)", () => {
  for (const [who, lines] of [["adopter", adopterNextSteps(F)], ["joiner", joinerNextSteps(F)]] as const) {
    it(`${who}: every path it prints is one setup seeds`, () => {
      const paths = printedPaths(lines);
      expect(paths.length).to.be.greaterThan(0);
      for (const p of paths) expect(SEEDED.has(p), `${p} is not seeded`).to.equal(true);
    });

    it(`${who}: in the reading list, every description sits under a path`, () => {
      // A description is indented six spaces; the line above it is a path or another line of the same description.
      lines.forEach((l, i) => {
        if (!/^ {6}\S/.test(l) || i === 0) return;
        let j = i - 1;
        while (j > 0 && /^ {6}\S/.test(lines[j]!)) j--;
        expect(lines[j], `orphan description: ${l.trim()}`).to.contain(HOME);
      });
    });
  }

  it("the adopter reads who approves what, and what may never leave the organization", () => {
    const t = adopterNextSteps(F).join("\n");
    expect(t).to.contain(`${HOME}/policies/authorized-representatives.md`);
    expect(t).to.contain(`${HOME}/policies/data-classification.md`);
  });

  it("the review issue names only documents setup seeds", () => {
    const body = starterProject("acme", "acme-gov").issueBody;
    for (const m of body.matchAll(/`([A-Za-z0-9_./-]+\.(?:md|yaml))`/g)) {
      expect(SEEDED.has(m[1]!), `${m[1]} is not seeded`).to.equal(true);
    }
    expect(body, "no orphan first line").to.not.match(/^ {2}setup\. Name the people/m);
  });
});

describe("gov-work — option B is named for what it is (walk #7)", () => {
  it("editing on main and pushing is a GOV-FRM-040 violation, said plainly, and C is recommended", () => {
    const t = adopterNextSteps(F).join("\n");
    const b = t.slice(t.indexOf("  B. "), t.indexOf("  C. "));
    expect(b).to.contain("GOV-FRM-040");
    expect(b).to.match(/pull request/);
    expect(b).to.not.match(/commit and push/);
    expect(t.slice(t.indexOf("  C. "))).to.match(/recommended/i);
  });
});

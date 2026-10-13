// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * THE BUILD PHASE'S POLICY (PRJ-121 intent 01, spec §2 and §3.2 — task L02b).
 *
 * `policies/build/policy.md` is §2–§3 of the old `org-policy.md` (engineering standards, technology choices); the
 * umbrella keeps §1 and §4–§8. The two share one set of section numbers, so a section number names one section
 * across both. It ships `seed-new`: `gov setup` creates it, and `gov upgrade` never hands it to an org that adopted
 * before it shipped (that org still has those sections in its own org-policy.md).
 */
import { expect } from "chai";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { parseManifest } from "../../src/maintain/upgrade-sync.js";

const CONTENT = fileURLToPath(new URL("../../../../content/", import.meta.url));
const read = (rel: string): string => fs.readFileSync(path.join(CONTENT, rel), "utf8");
const chapters = (text: string): string[] => [...text.matchAll(/^## (\d+)\. /gm)].map((m) => m[1]!);

describe("policies/build/policy.md — the build phase's policy (spec 01 §3.2, L02b)", () => {
  it("holds §2 and §3, and the umbrella keeps §1 and §4–§8 — no section number in both", () => {
    expect(chapters(read("policies/build/policy.md"))).to.deep.equal(["2", "3"]);
    expect(chapters(read("policies/org-policy.md"))).to.deep.equal(["1", "4", "5", "6", "7", "8"]);
  });

  it("the umbrella points at it, and the approved-technologies list cites its §3", () => {
    expect(read("policies/org-policy.md")).to.contain("`policies/build/policy.md`");
    const tech = read("policies/build/approved-technologies.md");
    expect(tech).to.contain("`policies/build/policy.md` section 3");
    expect(tech).to.not.match(/org-policy\.md` section 3/);
  });

  it("ships seed-new: a starter for new orgs, never planned by an upgrade", () => {
    const m = parseManifest(read("MANIFEST.yaml"));
    const row = m.files.find((e) => e.dst === "policies/build/policy.md");
    expect(row, "no MANIFEST row for policies/build/policy.md").to.not.equal(undefined);
    expect(row!.mode).to.equal("seed-new");
    expect(row!.src).to.equal(row!.dst);
  });
});

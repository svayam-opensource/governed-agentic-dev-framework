// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/** Spec 03 §2.3 — every lifecycle template carries every section its artifact requires, and the Status line. */
import { expect } from "chai";
import * as fs from "node:fs";
import * as path from "node:path";
import { ARTIFACT_SECTIONS, missingSections, statusOf, type ArtifactKind } from "../../src/intent/lifecycle-policy.js";

const CONTENT = path.join(import.meta.dirname, "..", "..", "..", "..", "content");
const LIB = path.join(CONTENT, "policies", "reference", "lifecycles", "ai-sdlc");

describe("lifecycle templates — §2.3 sections", () => {
  it("the section table covers the six artifacts, as spec §2.3 lists them", () => {
    expect(Object.keys(ARTIFACT_SECTIONS).sort()).to.deep.equal(["build", "deploy", "intent", "plan", "run", "spec"]);
    expect(ARTIFACT_SECTIONS.intent).to.deep.equal(["Goal", "Why", "Board items", "Rulings it carries", "Affected units", "Interview decisions", "Out", "Done when"]);
    expect(ARTIFACT_SECTIONS.plan).to.include.members(["Test plan", "Documentation plan"]);
  });

  for (const kind of ["intent", "spec", "plan", "build", "deploy", "run"] as ArtifactKind[]) {
    it(`${kind}.md has every required section, front matter and a DRAFT Status line`, () => {
      const text = fs.readFileSync(path.join(LIB, `${kind}.md`), "utf8");
      expect(missingSections(kind, text)).to.deep.equal([]);
      expect(text.startsWith("---\n")).to.equal(true);
      expect(statusOf(text)).to.deep.equal({ kind: "draft" });
    });
  }

  it("a missing section is named", () => {
    expect(missingSections("plan", "## Tasks\n## Order\n## Test plan\n## Rollout\n")).to.deep.equal(["Documentation plan"]);
  });

  it("reads the three Status forms, and none", () => {
    expect(statusOf("**Status:** DRAFT")).to.deep.equal({ kind: "draft" });
    expect(statusOf("**Status: APPROVED by Ada 2026-10-12 (https://x/pull/1)**")).to.deep.equal({ kind: "approved", text: "by Ada 2026-10-12 (https://x/pull/1)" });
    expect(statusOf("**Status:** STALE (spec changed)")).to.deep.equal({ kind: "stale", text: "(spec changed)" });
    expect(statusOf("no status")).to.equal(null);
  });
});

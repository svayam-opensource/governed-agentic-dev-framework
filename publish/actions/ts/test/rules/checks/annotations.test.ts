// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
//
// FINDINGS AS GITHUB ACTIONS ANNOTATIONS. A CI run's log can come back empty from the API; the check run's
// annotations do not. So `gov check run` prints one workflow command per finding when it runs in Actions, and
// anything that must read what it found (the rule-model journey) reads the annotations.
import { expect } from "chai";
import { annotationLines, escapeData, escapeProperty, findingLocation, headingLine } from "../../../src/rules/checks/annotations.js";

describe("check annotations — GitHub workflow commands for findings", () => {
  it("escapes a message per GitHub's rules: % first, then CR and LF", () => {
    expect(escapeData("100% done\r\nnext\nline")).to.equal("100%25 done%0D%0Anext%0Aline");
    expect(escapeData("%0A is literal")).to.equal("%250A is literal");
  });

  it("escapes a property value further: : and , too", () => {
    expect(escapeProperty("a:b,c%\n")).to.equal("a%3Ab%2Cc%25%0A");
  });

  it("a fail → ::error per finding, titled with the rule id; a warn: finding stays a warning", () => {
    const lines = annotationLines("GOV-FRM-455", { verdict: "fail", findings: ["GOV-FRM-455 [x]: @chuck has not approved.", "warn: soft miss"] });
    expect(lines).to.deep.equal([
      "::error title=GOV-FRM-455::GOV-FRM-455 [x]: @chuck has not approved.",
      "::warning title=GOV-FRM-455::warn: soft miss",
    ]);
  });

  it("cannot-tell → ::warning for every finding; a pass with on_miss warn findings → ::warning", () => {
    expect(annotationLines("GOV-FRM-040", { verdict: "cannot-tell", findings: ["no event"] }))
      .to.deep.equal(["::warning title=GOV-FRM-040::no event"]);
    expect(annotationLines("GOV-FRM-040", { verdict: "pass", findings: ["warn: missed"] }))
      .to.deep.equal(["::warning title=GOV-FRM-040::warn: missed"]);
    expect(annotationLines("GOV-FRM-040", { verdict: "pass", findings: [] })).to.deep.equal([]);
  });

  it("a multi-line finding is one annotation, its newlines escaped", () => {
    expect(annotationLines("GOV-FRM-1", { verdict: "fail", findings: ["first\nsecond 50%"] }))
      .to.deep.equal(["::error title=GOV-FRM-1::first%0Asecond 50%25"]);
  });

  it("a finding naming a policy section gets file= and line= — the section heading's line", () => {
    const policy = "# Org policy\n\nIntro.\n\n## 4 Data\n\nKeep it safe.\n\n### 4.2 Retention\n\nSeven years.\n";
    const read = (f: string) => (f === "policies/org-policy.md" ? policy : null);
    const msg = "GOV-FRM-467 [gov-builtin/policy-pr-gate]: policies/org-policy.md §4.2 (abc1234) was added or changed, and the policies/CHANGELOG.md entry for 1.5.0 does not list it";
    expect(annotationLines("GOV-FRM-467", { verdict: "fail", findings: [msg] }, read))
      .to.deep.equal([`::error title=GOV-FRM-467,file=policies/org-policy.md,line=9::${msg}`]);
  });

  it("a backticked path is found too; a file that cannot be read, or a section it lacks, gets file= without line=", () => {
    const msg = "GOV-FRM-455 [a]: @chuck has not approved this change to `policies/org-policy.md` §4 (Check Owner).";
    expect(annotationLines("GOV-FRM-455", { verdict: "fail", findings: [msg] }, () => null))
      .to.deep.equal([`::error title=GOV-FRM-455,file=policies/org-policy.md::${msg}`]);
    expect(annotationLines("GOV-FRM-455", { verdict: "fail", findings: [msg] }, () => "## 5 Other\n"))
      .to.deep.equal([`::error title=GOV-FRM-455,file=policies/org-policy.md::${msg}`]);
  });

  it("findingLocation: the first repository path, and the § after it; a URL is not a path", () => {
    expect(findingLocation("see https://github.com/acme/x/actions/runs/9 for it")).to.equal(null);
    expect(findingLocation("policies/VERSION.md went from 1 to 2")).to.deep.equal({ file: "policies/VERSION.md" });
    expect(findingLocation("x: policies/a.md §3 changed")).to.deep.equal({ file: "policies/a.md", section: "3" });
    expect(findingLocation("no path here")).to.equal(null);
  });

  it("headingLine: 1-based, numbered headings only, never inside a fence", () => {
    const text = "```\n## 4 Fake\n```\n## 4. Data\n";
    expect(headingLine(text, "4")).to.equal(4);
    expect(headingLine(text, "5")).to.equal(undefined);
  });
});

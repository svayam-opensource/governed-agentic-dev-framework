// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * F22 — AN ORG REPO MADE FROM THE TEMPLATE KEPT THE FRAMEWORK'S README.
 *
 * The template copy brings the framework's root README; the MANIFEST's seed-once README.md row then saw a file
 * present and never seeded the org's. The framework's README is now a recognised template leftover: replaced, once,
 * by the org README with its tokens filled. A README the org wrote is never touched (GOV-FRM-445).
 */
import { expect } from "chai";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { isFrameworkReadme, settleFrameworkReadme } from "../../src/maintain/framework-readme.js";
import { replaceFrameworkReadme, runUpgradeSync } from "../../src/maintain/upgrade-run.js";

const repoRoot = fileURLToPath(new URL("../../../../../", import.meta.url));
const frameworkReadme = fs.readFileSync(path.join(repoRoot, "README.md"), "utf8");
const contentDir = path.join(repoRoot, "publish", "content");
const orgReadme = fs.readFileSync(path.join(contentDir, "README.md"), "utf8");

function templateCopy(readme: string): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "f22-"));
  fs.writeFileSync(path.join(d, "README.md"), readme);
  fs.writeFileSync(path.join(d, "org-config.yaml"), 'org_name: "Acme Corp"\norg_short_name: "Acme"\norg_slug: "ACME"\n');
  return d;
}

describe("F22 — the framework's README left by the template copy", () => {
  it("the framework's CURRENT root README is recognised — add its fingerprint when it changes", () => {
    expect(isFrameworkReadme(frameworkReadme), "framework-readme.ts FRAMEWORK_README_FINGERPRINTS lacks the current README.md").to.equal(true);
    expect(isFrameworkReadme(frameworkReadme.replace(/\n/g, "\r\n")), "a CRLF checkout of it too").to.equal(true);
  });

  it("the org's own README template is not mistaken for the framework's", () => {
    expect(isFrameworkReadme(orgReadme)).to.equal(false);
  });

  it("a template copy gets the org README, tokens filled — by gov upgrade --apply", () => {
    const d = templateCopy(frameworkReadme);
    const lines = replaceFrameworkReadme(d, contentDir, true);
    const now = fs.readFileSync(path.join(d, "README.md"), "utf8");
    expect(lines.join("\n")).to.match(/replaced by the organization's README/);
    expect(now).to.match(/^# Acme Corp — governance repository/);
    expect(now).to.not.include("<ORG_NAME>");
    expect(replaceFrameworkReadme(d, contentDir, true), "once: the org README is not the framework's").to.deep.equal([]);
  });

  it("a dry run says it would, and writes nothing", () => {
    const d = templateCopy(frameworkReadme);
    const r = runUpgradeSync(contentDir, d, { apply: false });
    expect(r.lines.join("\n")).to.match(/README\.md .*left by the template copy/);
    expect(fs.readFileSync(path.join(d, "README.md"), "utf8")).to.equal(frameworkReadme);
  });

  it("a README the org wrote is never touched — even one edited from the framework's (GOV-FRM-445)", () => {
    for (const own of ["# Acme governance\n\nOurs.\n", frameworkReadme.replace("Governed Agentic", "Acme's Governed Agentic")]) {
      const d = templateCopy(own);
      expect(replaceFrameworkReadme(d, contentDir, true)).to.deep.equal([]);
      expect(fs.readFileSync(path.join(d, "README.md"), "utf8")).to.equal(own);
    }
  });

  it("the framework's own checkout (no org-config.yaml) keeps its README", () => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), "f22-fw-"));
    fs.writeFileSync(path.join(d, "README.md"), frameworkReadme);
    expect(replaceFrameworkReadme(d, contentDir, true)).to.deep.equal([]);
    expect(settleFrameworkReadme(null, orgReadme, (t) => t)).to.equal(null);
  });
});

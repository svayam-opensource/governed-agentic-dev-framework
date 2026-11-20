// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * THE POLICY DOCUMENT'S TWO FILES THROUGH SETUP AND UPGRADE (F127, 2026-11-20).
 *
 * framework/policy-document.yaml is the framework's: `gov upgrade` replaces it. policies/policy-document.yaml is the
 * organization's: seeded once (by setup, or by the first upgrade that ships it), then never rewritten — whatever the
 * organization wrote there survives every upgrade.
 */
import { expect } from "chai";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { runUpgradeSync } from "../../src/maintain/upgrade-run.js";
import { parseManifest } from "../../src/maintain/upgrade-sync.js";

const CONTENT = fileURLToPath(new URL("../../../../content/", import.meta.url));
const FW = "framework/policy-document.yaml", ORG = "policies/policy-document.yaml";

const MANIFEST = `
version: "2.1.0"
files:
  - { src: VERSION, dst: VERSION, mode: scaffold-auto }
  - { src: ${FW}, dst: ${FW}, mode: scaffold-auto }
  - { src: ${ORG}, dst: ${ORG}, mode: seed-once }
`;
const SHIPPED_FW = "chapters:\n  - { number: 1, title: \"Purpose, scope and authority\", intro: \"The new framework intro.\" }\nglossary: []\n";
const SHIPPED_ORG = "title_page:\n  title: \"Development and Operations Policy\"\nchapters: []\nglossary: []\n";

function tree(files: Record<string, string>, prefix: string): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  for (const [rel, text] of Object.entries(files)) { fs.mkdirSync(path.dirname(path.join(d, rel)), { recursive: true }); fs.writeFileSync(path.join(d, rel), text); }
  return d;
}
const content = (): string => tree({ "MANIFEST.yaml": MANIFEST, VERSION: "2.1.0\n", [FW]: SHIPPED_FW, [ORG]: SHIPPED_ORG }, "poldoc-content-");
const read = (d: string, rel: string): string | null => (fs.existsSync(path.join(d, rel)) ? fs.readFileSync(path.join(d, rel), "utf8") : null);

describe("policy-document.yaml — the framework's replaced, the organization's seeded once (F127)", () => {
  it("the shipped MANIFEST carries the framework's file scaffold-auto and the organization's seed-once", () => {
    const m = parseManifest(fs.readFileSync(path.join(CONTENT, "MANIFEST.yaml"), "utf8"));
    expect(m.files.find((e) => e.dst === FW)?.mode).to.equal("scaffold-auto");
    expect(m.files.find((e) => e.dst === ORG)?.mode).to.equal("seed-once");
  });

  it("setup's seed places both", () => {
    const c = content(), a = tree({}, "poldoc-new-");
    expect(runUpgradeSync(c, a, { apply: true, seed: true }).code).to.equal(0);
    expect(read(a, FW)).to.equal(SHIPPED_FW);
    expect(read(a, ORG)).to.equal(SHIPPED_ORG);
  });

  it("an upgrade replaces the framework's file and keeps what the organization wrote in its own", () => {
    const ours = "title_page:\n  title: \"Acme Engineering Policy\"\nchapters:\n  - { number: 3, intro: \"Ours.\" }\nglossary:\n  - { term: Widget, definition: Our product. }\n";
    const c = content(), a = tree({ VERSION: "2.0.0\n", [FW]: "chapters: []\nglossary: []\n", [ORG]: ours }, "poldoc-old-");
    expect(runUpgradeSync(c, a, { apply: true }).code).to.equal(0);
    expect(read(a, FW)).to.equal(SHIPPED_FW);
    expect(read(a, ORG)).to.equal(ours);
    // and a second upgrade still leaves it alone
    runUpgradeSync(c, a, { apply: true });
    expect(read(a, ORG)).to.equal(ours);
  });

  it("an upgrade into an organization that predates the file seeds its own once", () => {
    const c = content(), a = tree({ VERSION: "2.0.0\n" }, "poldoc-pre-");
    expect(runUpgradeSync(c, a, { apply: true }).code).to.equal(0);
    expect(read(a, ORG)).to.equal(SHIPPED_ORG);
    expect(read(a, FW)).to.equal(SHIPPED_FW);
  });
});

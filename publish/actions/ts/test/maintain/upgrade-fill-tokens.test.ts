// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * EVERY FILE GOV CREATES HAS ITS ORG TOKENS FILLED (PRJ-121 intent 01, spec §3.8).
 *
 * Setup's sweep resolves `<ORG_NAME>` and the rest in a new org repo. An upgrade used to fill them only in the role
 * list and the README, so a seed-once policy an upgrade created reached the org reading "<ORG_NAME>". Now one
 * `fillTokens` step runs over the files that upgrade CREATED — and only those: a file the organization wrote is never
 * rewritten, even when it holds a token (GOV-FRM-445).
 */
import { expect } from "chai";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import { runUpgradeSync, runUpgradePr, fillTokens } from "../../src/maintain/upgrade-run.js";
import { leftoverTokens } from "../../src/setup/create.js";

const tmp = (p: string): string => fs.mkdtempSync(path.join(os.tmpdir(), p));
const put = (root: string, rel: string, text: string): void => { fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true }); fs.writeFileSync(path.join(root, rel), text); };
const read = (root: string, rel: string): string | null => { try { return fs.readFileSync(path.join(root, rel), "utf8"); } catch { return null; /* absent */ } };

const POLICY = "# <ORG_NAME> — approved technologies\n\nOwner: <POLICY_OWNER_EMAIL>. Effective <POLICY_EFFECTIVE_DATE>.\n";
const ORG_WRITTEN = "# Our notes\n\nWe keep the literal <ORG_NAME> here on purpose.\n";

function content(): string {
  const c = tmp("filltok-content-");
  put(c, "MANIFEST.yaml", [
    "files:",
    "  - { src: VERSION, dst: VERSION, mode: scaffold-auto }",
    "  - { src: policies/approved-technologies.md, dst: policies/approved-technologies.md, mode: seed-once }",
    "  - { src: policies/org-policy.md, dst: policies/org-policy.md, mode: seed-once }",
    "",
  ].join("\n"));
  put(c, "VERSION", "2.0.0\n");
  put(c, "policies/approved-technologies.md", POLICY);
  put(c, "policies/org-policy.md", "# <ORG_NAME> — organization policy (shipped)\n");
  return c;
}
function workspace(): string {
  const ws = tmp("filltok-ws-");
  put(ws, "org-config.yaml", 'org_name: "Acme Corp"\norg_slug: "acme"\ngithub_org: "acme"\n');
  put(ws, "policies/governance.yaml", "policy_owner:\n  email: po@acme.test\n  github: acme-po\n");
  put(ws, "VERSION", "1.9.0\n");
  put(ws, "policies/org-policy.md", ORG_WRITTEN);          // the org's own copy of a shipped seed-once file
  put(ws, "policies/notes.md", ORG_WRITTEN);               // a file gov never shipped
  return ws;
}

describe("gov upgrade fills the org tokens in every file it creates — and only those (spec §3.8)", function () {
  this.timeout(30000);

  it("an upgrade that creates a seed-once policy leaves no token in it", () => {
    const c = content(), ws = workspace();
    const r = runUpgradeSync(c, ws, { apply: true });
    expect(r.code, r.lines.join("\n")).to.equal(0);
    const created = read(ws, "policies/approved-technologies.md")!;
    expect(leftoverTokens(created)).to.deep.equal([]);
    expect(created).to.match(/^# Acme Corp — approved technologies/);
    expect(created).to.include("po@acme.test");
  });

  it("a file the organization wrote is never touched, even with <ORG_NAME> in it (GOV-FRM-445)", () => {
    const c = content(), ws = workspace();
    runUpgradeSync(c, ws, { apply: true });
    expect(read(ws, "policies/org-policy.md")).to.equal(ORG_WRITTEN);
    expect(read(ws, "policies/notes.md")).to.equal(ORG_WRITTEN);
  });

  it("a dry run writes nothing", () => {
    const c = content(), ws = workspace();
    runUpgradeSync(c, ws, { apply: false });
    expect(read(ws, "policies/approved-technologies.md")).to.equal(null);
  });

  it("setup's seed leaves the tokens for setup's own sweep (the org's answers are not written yet)", () => {
    const c = content(), ws = tmp("filltok-seed-");
    runUpgradeSync(c, ws, { apply: true, seed: true });
    expect(read(ws, "policies/approved-technologies.md")).to.equal(POLICY);
  });

  it("fillTokens fills only the paths it is given, and only where org-config.yaml names a value", () => {
    const ws = workspace();
    put(ws, "a.md", "<ORG_NAME> <UNKNOWN_TOKEN>\n");
    put(ws, "b.md", "<ORG_NAME>\n");
    fillTokens(ws, ["a.md", "missing.md"], "2026-10-12");
    expect(read(ws, "a.md")).to.equal("Acme Corp <UNKNOWN_TOKEN>\n");
    expect(read(ws, "b.md")).to.equal("<ORG_NAME>\n");
  });

  it("gov upgrade --pr: the created policy on the upgrade branch has its tokens filled", () => {
    const c = content(), ws = workspace();
    const remote = tmp("filltok-remote-");
    execFileSync("git", ["init", "-q", "--bare", remote]);
    const g = (...a: string[]): string => execFileSync("git", ["-C", ws, ...a], { encoding: "utf8" }).trim();
    g("init", "-q", "-b", "main"); g("config", "user.email", "t@example.com"); g("config", "user.name", "t");
    g("remote", "add", "origin", remote);
    g("add", "-A"); g("commit", "-qm", "seed");
    const r = runUpgradePr(c, ws, { userHome: tmp("filltok-home-"), openPr: () => "https://example.test/pr/1" });
    expect(r.code, r.lines.join("\n")).to.equal(0);
    expect(leftoverTokens(g("show", "gov-upgrade-2.0.0:policies/approved-technologies.md"))).to.deep.equal([]);
    expect(g("show", "gov-upgrade-2.0.0:policies/org-policy.md") + "\n").to.equal(ORG_WRITTEN);
  });
});

// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * `gov upgrade --pr` RETURNS THE CLONE TO THE BRANCH IT WAS ON (adoption walk #10, 2026-10-07).
 *
 * It used to leave the governance clone checked out on `gov-upgrade-<v>`. Close that PR and gov could no longer
 * resolve its own repository from it; run the upgrade again and it failed with "branch already exists".
 */
import { expect } from "chai";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import { runUpgradePr } from "../../src/maintain/upgrade-run.js";

const gitOk = (): boolean => { try { execFileSync("git", ["--version"], { stdio: "ignore" }); return true; } catch { return false; } };
const tmp = (p: string): string => fs.mkdtempSync(path.join(os.tmpdir(), p));
const write = (root: string, rel: string, text: string): void => { fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true }); fs.writeFileSync(path.join(root, rel), text); };

function setup(): { content: string; adopter: string; g: (...a: string[]) => string } {
  const content = tmp("govpr-content-");
  write(content, "MANIFEST.yaml", "version: \"2.0.0\"\nfiles:\n  - { src: VERSION, dst: VERSION, mode: scaffold-auto }\n");
  write(content, "VERSION", "2.0.0\n");
  const remote = tmp("govpr-remote-");
  execFileSync("git", ["init", "-q", "--bare", remote]);
  const adopter = tmp("govpr-adopter-");
  const g = (...a: string[]): string => execFileSync("git", ["-C", adopter, ...a], { encoding: "utf8" }).trim();
  g("init", "-q", "-b", "main"); g("config", "user.email", "t@example.com"); g("config", "user.name", "t");
  g("remote", "add", "origin", remote);
  write(adopter, "VERSION", "1.0.0\n");
  write(adopter, "org-config.yaml", 'github_org: "acme"\n');
  g("add", "-A"); g("commit", "-qm", "seed");
  return { content, adopter, g };
}

(gitOk() ? describe : describe.skip)("gov upgrade --pr — the clone goes back to its branch", () => {
  it("after opening the PR, the clone is back on the branch it was on, and the output says so", () => {
    const { content, adopter, g } = setup();
    const r = runUpgradePr(content, adopter, { userHome: tmp("govpr-home-"), openPr: () => "https://example.test/pr/1" });
    expect(r.code, r.lines.join("\n")).to.equal(0);
    expect(g("rev-parse", "--abbrev-ref", "HEAD")).to.equal("main");
    expect(r.lines.join("\n")).to.match(/switched this clone back to main/);
    expect(g("show", "gov-upgrade-2.0.0:VERSION")).to.equal("2.0.0");
    expect(fs.readFileSync(path.join(adopter, "VERSION"), "utf8"), "the working tree is main's again").to.equal("1.0.0\n");
  });

  it("when the push fails, the clone still goes back to its branch", () => {
    const { content, adopter, g } = setup();
    g("remote", "set-url", "origin", path.join(tmp("govpr-gone-"), "missing.git"));
    const r = runUpgradePr(content, adopter, { userHome: tmp("govpr-home-"), openPr: () => "unused" });
    expect(r.code).to.equal(1);
    expect(g("rev-parse", "--abbrev-ref", "HEAD")).to.equal("main");
    expect(r.lines.join("\n")).to.match(/switched this clone back to main/);
  });

  it("when opening the PR fails, the clone still goes back to its branch", () => {
    const { content, adopter, g } = setup();
    const r = runUpgradePr(content, adopter, { userHome: tmp("govpr-home-"), openPr: () => { throw new Error("gh: not signed in"); } });
    expect(r.code).to.equal(0);
    expect(g("rev-parse", "--abbrev-ref", "HEAD")).to.equal("main");
    expect(r.lines.join("\n")).to.match(/open the PR manually/);
  });

  it("an upgrade branch left by an earlier (closed) PR → says what it is and how to clear it, and stays on its branch", () => {
    const { content, adopter, g } = setup();
    g("branch", "gov-upgrade-2.0.0");
    const r = runUpgradePr(content, adopter, { userHome: tmp("govpr-home-"), openPr: () => "unused" });
    expect(r.code).to.equal(1);
    const out = r.lines.join("\n");
    expect(out).to.match(/gov-upgrade-2\.0\.0.*already exists in this clone/);
    expect(out).to.match(/earlier `gov upgrade --pr`/);
    expect(out).to.include("git -C");
    expect(out).to.match(/branch -D gov-upgrade-2\.0\.0/);
    expect(out).to.match(/--branch <name>/);
    expect(g("rev-parse", "--abbrev-ref", "HEAD")).to.equal("main");
  });
});

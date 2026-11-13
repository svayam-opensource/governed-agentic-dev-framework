// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
//
// gov 1.2.4 (PRJ-121 F55, ruling A): a 1.x gov never applies content of a newer major version. Its `gov upgrade`
// fetches the template's `main`; once that holds gov 2.0's content, 1.x would write 2.x files without the 2.x
// migration. It refuses before planning anything, changes nothing, and says how to upgrade.
import { expect } from "chai";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { contentTooNew, majorOf } from "../../src/maintain/upgrade-guard.js";

describe("upgrade guard: content of a newer major version is refused (gov 1.2.4)", () => {
  it("reads a major version, pre-releases included; anything else is null", () => {
    expect([majorOf("1.2.3"), majorOf("2.0.0-next.3"), majorOf("v2.1.0"), majorOf(" 10.0.1\n")]).to.deep.equal([1, 2, 2, 10]);
    expect([majorOf(""), majorOf(null), majorOf("next"), majorOf("2")]).to.deep.equal([null, null, null, null]);
  });

  it("refuses only a NEWER major: equal, older and unreadable versions pass as before", () => {
    expect(contentTooNew("1.2.4", "2.0.0-next.3")).to.be.an("array");
    expect(contentTooNew("1.2.4", "1.2.3")).to.equal(null);
    expect(contentTooNew("1.2.4", "1.9.0")).to.equal(null);
    expect(contentTooNew("2.0.0", "1.2.3")).to.equal(null);
    expect(contentTooNew("1.2.4", null)).to.equal(null, "no VERSION: no new failure mode");
    expect(contentTooNew("0.0.0", "2.0.0")).to.be.an("array");
    expect(contentTooNew("garbage", "2.0.0")).to.equal(null);
  });

  it("says what happened, that nothing changed, and the way on — both OSes, and how to stay on 1.x", () => {
    const t = contentTooNew("1.2.4", "2.0.0-next.3")!.join("\n");
    expect(t).to.include("this content is gov 2.0.0-next.3, and this gov is 1.2.4");
    expect(t).to.include("Nothing was changed.");
    expect(t).to.include("https://gov.svayamtech.com/upgrade.sh");
    expect(t).to.include("irm https://gov.svayamtech.com/upgrade.ps1 | iex");
    expect(t).to.include("gov upgrade --ref gov-work-1.2.4");
  });
});

describe("gov upgrade --from <2.x content>: refused end to end, nothing written", function () {
  this.timeout(60_000);
  const here = path.dirname(fileURLToPath(import.meta.url));
  const bin = path.resolve(here, "../../src/cli/bin.ts");
  const tsx = path.resolve(here, "../../node_modules/.bin/tsx");

  const workspace = (): string => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), "gov-guard-home-"));
    fs.writeFileSync(path.join(d, "org-config.yaml"), 'org_name: "Acme"\ngithub_org: "acme"\nworkspace_repo: "acme-gov"\n');
    fs.writeFileSync(path.join(d, "VERSION"), "1.2.3\n");
    return d;
  };
  const content = (version: string): string => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), "gov-guard-content-"));
    fs.writeFileSync(path.join(d, "VERSION"), `${version}\n`);
    fs.writeFileSync(path.join(d, "MANIFEST.yaml"), "files:\n  - { src: README.md, dst: README.md, mode: overwrite }\n");
    fs.writeFileSync(path.join(d, "README.md"), "# new\n");
    return d;
  };
  const snapshot = (d: string): string => fs.readdirSync(d).sort().map((f) => `${f}:${fs.readFileSync(path.join(d, f), "utf8")}`).join("|");

  for (const mode of [[], ["--apply"]] as const) {
    it(`${mode.length ? "--apply" : "dry run"}: exit 1, the message on stderr, the workspace untouched`, () => {
      const home = workspace();
      const before = snapshot(home);
      const r = spawnSync(tsx, [bin, "upgrade", "--from", content("2.0.0-next.3"), "--gov-home", home, ...mode], { encoding: "utf8" });
      expect(r.status, r.stderr + r.stdout).to.equal(1);
      expect(r.stderr).to.include("gov 1.x cannot apply gov 2.x content");
      expect(r.stderr).to.include("upgrade.sh");
      expect(snapshot(home)).to.equal(before);
    });
  }

  it("1.x content still upgrades as before (the guard lets it through)", () => {
    const home = workspace();
    const r = spawnSync(tsx, [bin, "upgrade", "--from", content("1.2.3"), "--gov-home", home], { encoding: "utf8" });
    expect(r.stderr).to.not.include("cannot apply");
    expect(r.status, r.stderr + r.stdout).to.equal(0);
  });
});

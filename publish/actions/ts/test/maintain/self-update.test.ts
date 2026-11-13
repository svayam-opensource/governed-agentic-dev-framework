// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
//
// `gov self-update` (PRJ-121 F55, ruling A): gov installs a newer gov where this one was installed — the npm beside
// the Node it runs on — follows its own line (next / latest) unless told otherwise, never replaces the MSI, asks
// before installing, and names the next step (the governance repo's `gov upgrade --pr`).
import { expect } from "chai";
import { spawnSync } from "node:child_process";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { formatSelfUpdatePlan, installKindOf, npmBeside, resolveTarget, selfUpdatePlan } from "../../src/maintain/self-update.js";

const TAGS = { latest: "1.2.3", next: "2.0.0-next.3" };

describe("gov self-update — which version", () => {
  it("follows the running gov's own line: a -next.N gov → next, a release → latest", () => {
    expect(resolveTarget({ current: "2.0.0-next.2", version: null, tag: null, distTags: TAGS })).to.deep.equal({ ok: true, version: "2.0.0-next.3", via: "the 'next' line" });
    expect(resolveTarget({ current: "1.2.3", version: null, tag: null, distTags: { ...TAGS, latest: "1.2.4" } })).to.deep.equal({ ok: true, version: "1.2.4", via: "the 'latest' line" });
  });

  it("--next / --latest choose the line; an explicit version wins; a bad one is refused", () => {
    expect(resolveTarget({ current: "1.2.3", version: null, tag: "next", distTags: TAGS })).to.include({ ok: true, version: "2.0.0-next.3" });
    expect(resolveTarget({ current: "2.0.0-next.2", version: null, tag: "latest", distTags: TAGS })).to.include({ ok: true, version: "1.2.3" });
    expect(resolveTarget({ current: "1.2.3", version: "2.0.0", tag: "next", distTags: null })).to.include({ ok: true, version: "2.0.0" });
    expect(resolveTarget({ current: "1.2.3", version: "two", tag: null, distTags: TAGS })).to.include({ ok: false });
  });

  it("registry unreadable, or no such tag → says so and how to name a version", () => {
    const r = resolveTarget({ current: "1.2.3", version: null, tag: null, distTags: null });
    expect(r.ok).to.equal(false);
    expect((r as { message: string }).message).to.include("gov self-update <x.y.z>");
    expect(resolveTarget({ current: "1.2.3", version: null, tag: "next", distTags: { latest: "1.2.3" } })).to.include({ ok: false });
  });
});

describe("gov self-update — where it installs", () => {
  it("the npm beside this gov's Node: install.sh / install.ps1 / npm -g alike", () => {
    expect(npmBeside("/home/a/.local/share/gov/node/bin/node", "linux")).to.equal("/home/a/.local/share/gov/node/bin/npm");
    expect(npmBeside("C:\\Users\\a\\AppData\\Local\\gov\\node\\node.exe", "win32")).to.equal("C:\\Users\\a\\AppData\\Local\\gov\\node\\npm.cmd");
  });

  it("the Windows MSI is recognised (and only on Windows, only under its program folder)", () => {
    const env = { LOCALAPPDATA: "C:\\Users\\a\\AppData\\Local" };
    expect(installKindOf("C:\\Users\\a\\AppData\\Local\\Programs\\gov\\app\\node_modules\\@svayam-opensource\\gov", "win32", env)).to.equal("msi");
    expect(installKindOf("C:\\Users\\a\\AppData\\Local\\gov\\node\\node_modules\\@svayam-opensource\\gov", "win32", env)).to.equal("npm");
    expect(installKindOf("C:\\Users\\a\\AppData\\Local\\Programs\\governance\\x", "win32", env)).to.equal("npm");
    expect(installKindOf("/home/a/.local/share/gov/node/lib/node_modules/@svayam-opensource/gov", "linux", env)).to.equal("npm");
  });
});

describe("gov self-update — the plan", () => {
  const ok = (version: string) => ({ ok: true as const, version, via: "the 'next' line" });

  it("npm install -g of the exact version, with the registry for the scoped package when one is named", () => {
    expect(selfUpdatePlan({ target: ok("2.0.0-next.3"), current: "2.0.0-next.2", kind: "npm", npm: "/n/npm" })).to.deep.include({
      kind: "install", args: ["install", "-g", "@svayam-opensource/gov@2.0.0-next.3"],
    });
    const p = selfUpdatePlan({ target: ok("2.0.0-next.3"), current: "2.0.0-next.2", kind: "npm", npm: "/n/npm", registry: "https://npm.example" });
    expect((p as { args: string[] }).args).to.deep.equal(["install", "-g", "--registry", "https://npm.example", "--@svayam-opensource:registry=https://npm.example", "@svayam-opensource/gov@2.0.0-next.3"]);
  });

  it("same version → up to date; the MSI → winget, never npm; an unresolved target → the error", () => {
    expect(selfUpdatePlan({ target: ok("2.0.0-next.2"), current: "2.0.0-next.2", kind: "npm", npm: "n" }).kind).to.equal("up-to-date");
    const msi = selfUpdatePlan({ target: ok("2.0.0"), current: "2.0.0-next.3", kind: "msi", npm: "n" });
    expect(msi.kind).to.equal("msi");
    expect(formatSelfUpdatePlan(msi, false).join("\n")).to.include("winget upgrade Svayam.Gov").and.include("gov upgrade --pr");
    expect(selfUpdatePlan({ target: { ok: false, message: "m" }, current: "1", kind: "npm", npm: "n" })).to.deep.equal({ kind: "error", message: "m" });
  });

  it("the message shows the exact command; a dry run says nothing was installed", () => {
    const p = selfUpdatePlan({ target: ok("2.0.0-next.3"), current: "2.0.0-next.2", kind: "npm", npm: "/n/npm" });
    const t = formatSelfUpdatePlan(p, true).join("\n");
    expect(t).to.include("2.0.0-next.2 → 2.0.0-next.3").and.include("/n/npm install -g @svayam-opensource/gov@2.0.0-next.3").and.include("dry run — nothing was installed");
  });
});

describe("gov self-update — through the CLI, installing nothing", function () {
  this.timeout(60_000);
  const here = path.dirname(fileURLToPath(import.meta.url));
  const bin = path.resolve(here, "../../src/cli/bin.ts");
  const tsx = path.resolve(here, "../../node_modules/.bin/tsx");
  const gov = (...a: string[]) => spawnSync(tsx, [bin, ...a], { encoding: "utf8", input: "", env: { ...process.env, GOV_NO_UPDATE_CHECK: "1" } });

  it("--dry-run with a version: exit 0, the exact command, nothing installed", () => {
    const r = gov("self-update", "9.9.9", "--dry-run");
    expect(r.status, r.stderr + r.stdout).to.equal(0);
    expect(r.stdout).to.include("→ 9.9.9").and.include("install -g @svayam-opensource/gov@9.9.9").and.include("nothing was installed");
  });

  it("no terminal and no --yes: refuses to install, exit 1", () => {
    const r = gov("self-update", "9.9.9");
    expect(r.status, r.stderr + r.stdout).to.equal(1);
    expect(r.stderr).to.include("no terminal to ask in. Add --yes");
  });

  it("the old `gov upgrade <version>` shows the self-update plan and installs nothing", () => {
    const r = gov("upgrade", "9.9.9");
    expect(r.status, r.stderr + r.stdout).to.equal(0);
    expect(r.stdout).to.include("gov self-update 9.9.9").and.include("nothing was installed");
  });
});

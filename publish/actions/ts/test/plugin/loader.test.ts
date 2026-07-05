// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
import { expect } from "chai";
import { isPluginCommand, loadGovOperate, runPluginCommand, type PluginCliContext } from "../../src/plugin/loader.js";
import type { OrgConfig } from "../../src/config/org-config.js";

const CTX: PluginCliContext = { home: "/gov", config: {} as OrgConfig, license: "L" };

describe("gov-work — enterprise plugin seam", () => {
  it("recognizes the plugin command namespace", () => {
    expect(isPluginCommand("deploy")).to.equal(true);
    expect(isPluginCommand("catalog")).to.equal(true);
    expect(isPluginCommand("data")).to.equal(true);
    expect(isPluginCommand("seed")).to.equal(false);
  });

  it("reports a clear install message when the plugin isn't installed", async () => {
    const load = await loadGovOperate(() => Promise.reject(new Error("Cannot find module")));
    expect(load.ok).to.equal(false);
    if (!load.ok) expect(load.message).to.match(/npm i -g @svayam\/gov-operate/);
  });

  it("rejects an installed package that lacks a runCli entry", async () => {
    const load = await loadGovOperate(() => Promise.resolve({ notRunCli: true }));
    expect(load.ok).to.equal(false);
    if (!load.ok) expect(load.message).to.match(/no `runCli` entry/);
  });

  it("delegates to the plugin's runCli when present", async () => {
    const importer = () => Promise.resolve({ runCli: (argv: readonly string[]) => Promise.resolve({ code: 0, lines: [`ran ${argv.join(" ")}`] }) });
    const r = await runPluginCommand(["catalog", "list"], CTX, importer);
    expect(r).to.deep.equal({ code: 0, lines: ["ran catalog list"] });
  });

  it("surfaces a plugin LicenseError as exit 1", async () => {
    const importer = () => Promise.resolve({ runCli: () => Promise.reject(new Error("gov-operate requires a valid license")) });
    const r = await runPluginCommand(["deploy", "x"], CTX, importer);
    expect(r.code).to.equal(1);
    expect(r.lines[0]).to.match(/requires a valid license/);
  });

  it("not-installed delegation returns exit 2 + the install hint", async () => {
    const r = await runPluginCommand(["deploy"], CTX, () => Promise.reject(new Error("no module")));
    expect(r.code).to.equal(2);
    expect(r.lines[0]).to.match(/enterprise command/);
  });
});

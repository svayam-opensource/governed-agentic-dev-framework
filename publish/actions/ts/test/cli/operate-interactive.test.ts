// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/** Interactive enterprise flows: only VALID type × sub-type × packaging combinations are
 *  offered/accepted, the bare `catalog` sub-menu, and env validation for deploy/data/promote.
 *  These exercise the pure prompt builders with a scripted prompt/print driver. */
import { expect } from "chai";
import { promptCreateUnit, promptForCommand, chooseFrom, type OperateFlowDeps } from "../../src/cli/operate-flow.js";
import type { PluginTaxonomy } from "../../src/plugin/loader.js";

// A representative copy of the gov-operate active taxonomy (its shape, not imported across the seam).
const TAX: readonly PluginTaxonomy[] = [
  { type: "svc", subTypes: ["api", "spa", "database", "idp", "mail", "data", "auth-config", "mail-config"], packagings: ["container", "rev-proxy-container"] },
  { type: "lib", subTypes: ["typescript", "angular"], packagings: ["npm"] },
  { type: "mobile", subTypes: ["OTA"], packagings: ["app-store", "play-store", "testflight"] },
  { type: "cli", subTypes: ["node"], packagings: ["npm"] },
  { type: "schedule", subTypes: ["node"], packagings: ["jenkins", "github-actions", "host-cron", "container-cron"] },
  { type: "solution", subTypes: [], packagings: [] },
];

const driver = (answers: string[]): { prompt: OperateFlowDeps["prompt"]; print: OperateFlowDeps["print"]; out: string[] } => {
  let i = 0; const out: string[] = [];
  return { prompt: async () => answers[i++] ?? "", print: (l) => out.push(l), out };
};

describe("interactive create — only VALID type × sub-type × packaging", () => {
  // one case per type that has a sub-type: its own first sub-type/packaging is accepted
  for (const t of TAX.filter((x) => x.subTypes.length > 0)) {
    it(`${t.type} → offers its own axes (accepts ${t.subTypes[0]} / ${t.packagings[0]})`, async () => {
      const d = driver(["u", t.type, t.subTypes[0], t.packagings[0], "owner/repo", "pkg/x", "", "", "", "because"]);
      const argv = await promptCreateUnit(d.prompt, d.print, TAX);
      expect(argv, "should build an argv").to.not.equal(null);
      expect(argv!).to.include.members(["--type", t.type, "--sub-type", t.subTypes[0], "--packaging", t.packagings[0]]);
    });
  }

  it("a sole axis is the Enter-default (cli → node / npm without typing)", async () => {
    const d = driver(["u", "cli", "", "", "owner/repo", "pkg/x", "", "", "", "because"]);
    const argv = await promptCreateUnit(d.prompt, d.print, TAX);
    expect(argv!).to.include.members(["--type", "cli", "--sub-type", "node", "--packaging", "npm"]);
  });

  it("REJECTS the reported invalid combo — cli + api", async () => {
    const d = driver(["u", "cli", "api"]);
    expect(await promptCreateUnit(d.prompt, d.print, TAX)).to.equal(null);
    expect(d.out.join("\n")).to.match(/sub-type must be one of: node/);
  });

  it("REJECTS svc + node (node isn't an svc sub-type)", async () => {
    const d = driver(["u", "svc", "node"]);
    expect(await promptCreateUnit(d.prompt, d.print, TAX)).to.equal(null);
  });

  it("REJECTS an unknown type", async () => {
    const d = driver(["u", "banana"]);
    expect(await promptCreateUnit(d.prompt, d.print, TAX)).to.equal(null);
    expect(d.out.join("\n")).to.match(/type must be one of/);
  });

  it("solution has NO sub-type/packaging axis → neither is prompted or emitted", async () => {
    const d = driver(["u", "solution", "owner/repo", "pkg/x", "", "", "", "because"]);
    const argv = await promptCreateUnit(d.prompt, d.print, TAX);
    expect(argv!).to.include.members(["--type", "solution"]);
    expect(argv!).to.not.include("--sub-type");
    expect(argv!).to.not.include("--packaging");
  });

  it("no taxonomy available → free-text fields, no validation (plugin validates)", async () => {
    const d = driver(["u", "cli", "api", "npm", "owner/repo", "pkg/x", "", "", "", "because"]);
    const argv = await promptCreateUnit(d.prompt, d.print, undefined);
    expect(argv!).to.include.members(["--type", "cli", "--sub-type", "api"]);   // accepted: no taxonomy to check against
  });
});

describe("chooseFrom — the valid-only primitive", () => {
  it("accepts a listed value; sole option defaults on Enter; skips when no options", async () => {
    expect(await chooseFrom(driver(["api"]).prompt, () => {}, "sub-type", ["api", "spa"])).to.equal("api");
    expect(await chooseFrom(driver([""]).prompt, () => {}, "sub-type", ["node"])).to.equal("node");     // Enter → sole
    expect(await chooseFrom(driver([""]).prompt, () => {}, "sub-type", [])).to.equal("");               // axis N/A
  });
  it("returns null on an unlisted value", async () => {
    expect(await chooseFrom(driver(["nope"]).prompt, () => {}, "packaging", ["npm"])).to.equal(null);
  });
});

describe("bare `catalog` sub-menu — uniform in the menu AND the CLI", () => {
  it("1 → catalog list", async () => {
    expect(await promptForCommand(["catalog"], driver(["1"]).prompt, () => {}, TAX)).to.deep.equal(["catalog", "list"]);
  });
  it("2 → guided create", async () => {
    const argv = await promptForCommand(["catalog"], driver(["2", "u", "cli", "", "", "owner/repo", "pkg/x", "", "", "", "because"]).prompt, () => {}, TAX);
    expect(argv?.slice(0, 3)).to.deep.equal(["catalog", "create", "u"]);
  });
  it("0 → back (clean no-op, empty argv)", async () => {
    expect(await promptForCommand(["catalog"], driver(["0"]).prompt, () => {}, TAX)).to.deep.equal([]);
  });
  it("`catalog list` (already specified) passes straight through", async () => {
    expect(await promptForCommand(["catalog", "list"], driver([]).prompt, () => {}, TAX)).to.deep.equal(["catalog", "list"]);
  });
});

describe("env validation across deploy / data / promote", () => {
  for (const env of ["local", "dev", "uat", "prod"]) {
    it(`deploy accepts env '${env}'`, async () => {
      expect(await promptForCommand(["deploy"], driver(["u", env]).prompt, () => {}, TAX)).to.deep.equal(["deploy", "u", env]);
    });
    it(`data accepts env '${env}'`, async () => {
      expect(await promptForCommand(["data"], driver(["u", env]).prompt, () => {}, TAX)).to.deep.equal(["data", "u", env]);
    });
  }
  it("deploy rejects a bad env", async () => {
    const d = driver(["u", "nope"]);
    expect(await promptForCommand(["deploy"], d.prompt, d.print, TAX)).to.equal(null);
    expect(d.out.join("\n")).to.match(/env must be one of: local, dev, uat, prod/);
  });
  it("promote validates from + to", async () => {
    expect(await promptForCommand(["promote"], driver(["u", "uat", "prod"]).prompt, () => {}, TAX)).to.deep.equal(["promote", "u", "uat", "prod"]);
  });
  it("promote rejects a bad 'to' env", async () => {
    expect(await promptForCommand(["promote"], driver(["u", "uat", "zzz"]).prompt, () => {}, TAX)).to.equal(null);
  });
});

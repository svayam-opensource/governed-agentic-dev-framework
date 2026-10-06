// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
//
// THE ORG'S ROLE LIST (W2-Q5, rule-model P3). The roles beyond the framework's two — and who holds them, and which
// knowledge/ folders they own — are the ORG's, written as a small table in `policies/authorized-representatives.md`.
// These tests pin the table's format, the parser's refusals, and the one-release fallback to the old
// `*_owner_github` keys in org-config.yaml.
import { expect } from "chai";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  parseRoleList, resolveRoles, roleHandles, LEGACY_DOMAIN_ROLES, ROLE_LIST_PATH,
} from "../../src/config/role-list.js";
import { substituteTokens, tokenValuesFromOrgConfig } from "../../src/setup/create.js";

const CONTENT = path.join(import.meta.dirname, "..", "..", "..", "..", "content");

const table = (...rows: string[]): string => [
  "# Authorized representatives", "", "Some prose a human reads.", "",
  "| Role | GitHub handle | Owns |",
  "|---|---|---|",
  ...rows,
  "", "More prose after the table.", "",
].join("\n");

describe("the org's role list — parseRoleList", () => {
  it("reads role → handle → knowledge/ folders, normalising both", () => {
    const r = parseRoleList(table(
      "| Data Owner | @dana | `knowledge/data/` |",
      "| Legal Owner | lex | `knowledge/legal/`, `/knowledge/contracts` |",
      "| Security Lead | @sec | — |",
    ));
    expect(r.found).to.equal(true);
    if (!r.found) return;
    expect(r.problems).to.deep.equal([]);
    expect(r.roles).to.deep.equal([
      { role: "Data Owner", holder: "@dana", owns: ["knowledge/data/"] },
      { role: "Legal Owner", holder: "@lex", owns: ["knowledge/legal/", "knowledge/contracts/"] },
      { role: "Security Lead", holder: "@sec", owns: [] },
    ]);
  });

  it("an empty or 'vacant' handle is a VACANCY, not a fault", () => {
    const r = parseRoleList(table("| Data Owner |  | `knowledge/data/` |", "| Legal Owner | vacant | `knowledge/legal/` |", "| Infra Owner | — | |"));
    expect(r.found && r.problems).to.deep.equal([]);
    expect(r.found && r.roles.map((x) => x.holder)).to.deep.equal([null, null, null]);
  });

  it("no table is NOT FOUND — never an empty list, which would read as 'the org defines no roles'", () => {
    expect(parseRoleList("# Authorized representatives\n\nJust prose.\n").found).to.equal(false);
    expect(parseRoleList("| Domain | Approver |\n|---|---|\n| Legal | Legal Owner |\n").found, "another table is not the role list").to.equal(false);
  });

  it("a table inside a code fence is an example, not the list", () => {
    expect(parseRoleList("```\n| Role | GitHub handle | Owns |\n|---|---|---|\n| X | @x | |\n```\n").found).to.equal(false);
  });

  it("refuses what it cannot route — and says why, row by row", () => {
    const r = parseRoleList(table(
      "| Policy Owner | @p | |",                            // framework role: org-config holds it
      "| Data Owner | <DATA_OWNER_GITHUB> | `knowledge/data/` |",   // unresolved token
      "| Ops Owner | not a handle! | `knowledge/ops/` |",
      "| Web Owner | @web | `site/` |",                      // outside knowledge/
      "| Root Owner | @root | `knowledge/` |",               // the whole tree is the Policy Owner's
      "| Glob Owner | @glob | `knowledge/*/` |",
      "| Data Owner | @dupe | |",                            // duplicate role
      "| Twin Owner | @twin | `knowledge/data/` |",          // folder already owned
    ));
    expect(r.found).to.equal(true);
    if (!r.found) return;
    const p = r.problems.join("\n");
    expect(p).to.match(/Policy Owner.*org-config\.yaml/);
    expect(p).to.match(/Data Owner.*<DATA_OWNER_GITHUB>/);
    expect(p).to.match(/Ops Owner.*not a GitHub handle/);
    expect(p).to.match(/site\/.*not under knowledge\//);
    expect(p).to.match(/Root Owner.*knowledge\/ itself/);
    expect(p).to.match(/knowledge\/\*\/.*pattern/);
    expect(p).to.match(/Data Owner.*listed twice/);
    expect(p).to.match(/knowledge\/data\/.*already owned by Data Owner/);
    expect(r.roles.map((x) => x.role), "framework roles and duplicates are dropped").to.deep.equal(
      ["Data Owner", "Ops Owner", "Web Owner", "Root Owner", "Glob Owner", "Twin Owner"]);
    expect(r.roles.find((x) => x.role === "Data Owner")!.holder, "an unresolved token is vacant").to.equal(null);
    expect(r.roles.find((x) => x.role === "Twin Owner")!.owns).to.deep.equal([]);
  });
});

describe("the org's role list — resolveRoles (and the one-release fallback)", () => {
  const CFG = 'policy_owner_github: "@polly"\ncheck_owner_github: "chuck"\nlegal_owner_github: "@lex"\ndata_arch_owner_github: ""\n';

  it("the table wins when it is there — the old keys are not read at all", () => {
    const r = resolveRoles(CFG, table("| Data Owner | @dana | `knowledge/data/` |"));
    expect(r.source).to.equal("role-list");
    expect(r.roles.map((x) => x.role)).to.deep.equal(["Data Owner"]);
  });

  it("no table → the legacy *_owner_github keys, with the folders the framework used to hard-code", () => {
    for (const text of [null, undefined, "# no table here\n"]) {
      const r = resolveRoles(CFG, text);
      expect(r.source).to.equal("org-config");
      expect(r.roles.map((x) => x.role), "only the keys the config carries").to.deep.equal(["Legal Owner", "Data Architecture Owner"]);
      expect(r.roles.find((x) => x.role === "Legal Owner")).to.deep.equal({ role: "Legal Owner", holder: "@lex", owns: ["knowledge/legal/"] });
      expect(r.roles.find((x) => x.role === "Data Architecture Owner")!.holder).to.equal(null);
    }
  });

  it("roleHandles: the two framework roles from org-config, every org role by name (vacant → empty)", () => {
    const r = resolveRoles(CFG, table("| Data Owner | @dana | `knowledge/data/` |", "| Legal Owner | | |"));
    expect(roleHandles(CFG, r.roles)).to.deep.equal({
      "Policy Owner": "@polly", "Check Owner": "chuck", "Data Owner": "@dana", "Legal Owner": "",
    });
    expect(roleHandles('policy_owner_github: "@polly"\n', [])["Check Owner"], "vacant Check Owner → the Policy Owner").to.equal("@polly");
    expect(roleHandles("", []), "no Policy Owner → no framework roles at all").to.deep.equal({});
  });
});

describe("the seeded role list", () => {
  const seeded = fs.readFileSync(path.join(CONTENT, ROLE_LIST_PATH), "utf8");

  it("the seeded authorized-representatives.md carries the table, with the four starter roles", () => {
    const r = parseRoleList(seeded);
    expect(r.found).to.equal(true);
    if (!r.found) return;
    expect(r.roles.map((x) => x.role)).to.deep.equal(LEGACY_DOMAIN_ROLES.map((x) => x.role));
    for (const legacy of LEGACY_DOMAIN_ROLES) {
      expect(r.roles.find((x) => x.role === legacy.role)!.owns).to.deep.equal(legacy.owns);
    }
  });

  it("setup's token sweep fills the handles from the org-config it just wrote (each defaults to the Policy Owner)", () => {
    const cfg = 'policy_owner_email: "p@acme.io"\nlegal_owner_github: "@lex"\ninfra_owner_github: "@rk"\n'
      + 'system_arch_owner_github: "@sys"\ndata_arch_owner_github: "@dana"\n';
    const r = parseRoleList(substituteTokens(seeded, tokenValuesFromOrgConfig(cfg)));
    expect(r.found && r.problems).to.deep.equal([]);
    expect(r.found && Object.fromEntries(r.roles.map((x) => [x.role, x.holder]))).to.deep.equal({
      "Legal Owner": "@lex", "Infrastructure Owner": "@rk", "System Architecture Owner": "@sys", "Data Architecture Owner": "@dana",
    });
  });
});

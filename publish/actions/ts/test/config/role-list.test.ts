// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
//
// THE ORG'S ROLE LIST (W2-Q5, rule-model P3). The roles beyond the framework's two — and who holds them, and which
// knowledge/ folders they own — are the ORG's, written as a small table in `policies/authorized-representatives.md`.
// These tests pin the table's format and the parser's refusals. There is no fallback to the old `*_owner_github`
// keys any more: the org-config split's upgrade migration carries them into the table (org-config-split.test.ts).
import { expect } from "chai";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  parseRoleList, resolveRoles, roleHandles, ROLE_LIST_PATH,
} from "../../src/config/role-list.js";
import { substituteTokens, setupTokenValues } from "../../src/setup/create.js";

const STARTER_ROLES = [
  { role: "Legal Owner", owns: ["knowledge/legal/"] },
  { role: "Infrastructure Owner", owns: ["knowledge/infrastructure/"] },
  { role: "System Architecture Owner", owns: ["knowledge/architecture/system/"] },
  { role: "Data Architecture Owner", owns: ["knowledge/architecture/data/"] },
];

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
    expect(p).to.match(/Policy Owner.*policies\/governance\.yaml/);
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

describe("the org's role list — resolveRoles (no fallback since the org-config split)", () => {
  it("the table is the list", () => {
    const r = resolveRoles(table("| Data Owner | @dana | `knowledge/data/` |"));
    expect(r.found).to.equal(true);
    expect(r.roles.map((x) => x.role)).to.deep.equal(["Data Owner"]);
  });

  it("no table → no roles of the org's own (the Policy Owner owns every folder)", () => {
    for (const text of [null, undefined, "# no table here\n"]) {
      expect(resolveRoles(text)).to.deep.equal({ found: false, roles: [], problems: [] });
    }
  });

  it("roleHandles: the two framework roles from governance.yaml, every org role by name (vacant → empty)", () => {
    const r = resolveRoles(table("| Data Owner | @dana | `knowledge/data/` |", "| Legal Owner | | |"));
    expect(roleHandles({ policyOwner: "@polly", checkOwner: "chuck" }, r.roles)).to.deep.equal({
      "Policy Owner": "@polly", "Check Owner": "chuck", "Data Owner": "@dana", "Legal Owner": "",
    });
    expect(roleHandles({ policyOwner: "@polly" }, [])["Check Owner"], "vacant Check Owner → the Policy Owner").to.equal("@polly");
    expect(roleHandles({}, []), "no Policy Owner → no framework roles at all").to.deep.equal({});
  });
});

describe("the seeded role list", () => {
  const seeded = fs.readFileSync(path.join(CONTENT, ROLE_LIST_PATH), "utf8");

  it("the seeded authorized-representatives.md carries the table, with the four starter roles", () => {
    const r = parseRoleList(seeded);
    expect(r.found).to.equal(true);
    if (!r.found) return;
    expect(r.roles.map((x) => x.role)).to.deep.equal(STARTER_ROLES.map((x) => x.role));
    for (const legacy of STARTER_ROLES) {
      expect(r.roles.find((x) => x.role === legacy.role)!.owns).to.deep.equal(legacy.owns);
    }
  });

  it("setup's token sweep fills every starter role with the Policy Owner — setup no longer asks for them", () => {
    const gov = 'policy_owner:\n  email: "p@acme.io"\n  github: "@polly"\n';
    const r = parseRoleList(substituteTokens(seeded, setupTokenValues('org_slug: "ACM"\n', gov, "2026-10-06")));
    expect(r.found && r.problems).to.deep.equal([]);
    expect(r.found && Object.fromEntries(r.roles.map((x) => [x.role, x.holder]))).to.deep.equal({
      "Legal Owner": "@polly", "Infrastructure Owner": "@polly", "System Architecture Owner": "@polly", "Data Architecture Owner": "@polly",
    });
  });
});

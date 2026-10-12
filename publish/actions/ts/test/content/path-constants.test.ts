// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * EVERY PATH CONSTANT NAMES A FILE GOV SHIPS (PRJ-121 intent 01, spec §3.1 — task L02).
 *
 * gov reads a governance repo through a handful of exported path constants. Each must name a destination the
 * MANIFEST seeds, at its spec §2 path — so a layout change that moves a file and forgets the constant (or the other way
 * round) fails here, not in an adopter's repo. Under T15 no constant keeps an old path as a fallback.
 */
import { expect } from "chai";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { expandEntries, parseManifest } from "../../src/maintain/upgrade-sync.js";
import { RULE_STORE_PATHS } from "../../src/rules/model/store-io.js";
import { MACHINE_WRITTEN_POLICY_PATHS } from "../../src/rules/checks/policy-actions.js";
import { ORG_CONFIG_SCHEMA_PATH } from "../../src/config/org-config.js";
import { ROLE_LIST_PATH } from "../../src/config/role-list.js";
import { GOVERNING_FILES } from "../../src/lifecycle/governance-snapshot.js";
import { TODO_TEMPLATE_PATH } from "../../src/maintain/framework-currency.js";
import { WORKFLOW_TEMPLATE } from "../../src/maintain/repo-protect.js";
import { REFERENCE_DOC_CANDIDATES } from "../../src/cli/reference-page.js";
import { GOVERNANCE_PATH } from "../../src/config/governance.js";
import { OWNERSHIP_PATH } from "../../src/rules/checks/ownership.js";
import { POL_ALIASES_PATH } from "../../src/rules/model/pol-aliases.js";

const CONTENT = fileURLToPath(new URL("../../../../content/", import.meta.url));
const PKG = fileURLToPath(new URL("../../", import.meta.url));

function contentFiles(dir: string, rel = ""): string[] {
  return fs.readdirSync(path.join(dir, rel), { withFileTypes: true }).flatMap((e) => {
    const r = rel ? `${rel}/${e.name}` : e.name;
    return e.isDirectory() ? contentFiles(dir, r) : [r];
  });
}
const SEEDED = new Set(expandEntries(parseManifest(fs.readFileSync(path.join(CONTENT, "MANIFEST.yaml"), "utf8")), contentFiles(CONTENT)).map((e) => e.dst));

const posix = (p: string): string => p.split(path.sep).join("/");

describe("path constants — each names a file setup seeds, at its §2 path (spec 01 §3.1, L02)", () => {
  const constants: Array<[string, string]> = [
    ...Object.entries(RULE_STORE_PATHS).map(([k, v]) => [`RULE_STORE_PATHS.${k}`, v] as [string, string]),
    ...MACHINE_WRITTEN_POLICY_PATHS.filter((p) => !p.includes("*")).map((p) => [`MACHINE_WRITTEN_POLICY_PATHS ${p}`, p] as [string, string]),
    ["ORG_CONFIG_SCHEMA_PATH", ORG_CONFIG_SCHEMA_PATH],
    ["ROLE_LIST_PATH", ROLE_LIST_PATH],
    ...GOVERNING_FILES.map((p) => [`GOVERNING_FILES ${p}`, p] as [string, string]),
    ["TODO_TEMPLATE_PATH", TODO_TEMPLATE_PATH],
    ["WORKFLOW_TEMPLATE", posix(WORKFLOW_TEMPLATE)],
    ["GOVERNANCE_PATH", GOVERNANCE_PATH],
    ["OWNERSHIP_PATH", OWNERSHIP_PATH],
    ["POL_ALIASES_PATH", POL_ALIASES_PATH],
  ];
  for (const [name, p] of constants) {
    it(`${name} = ${p} is seeded`, () => {
      expect(SEEDED.has(p), `${name} names ${p}, which the MANIFEST does not seed`).to.equal(true);
    });
  }

  it("the org store sits in policies/rules/, the framework catalog is checks-catalog.yaml (§2)", () => {
    expect(RULE_STORE_PATHS.frameworkCatalog).to.equal("framework/rules/checks-catalog.yaml");
    expect(RULE_STORE_PATHS.orgRules).to.equal("policies/rules/rules.yaml");
    expect(RULE_STORE_PATHS.orgCatalog).to.equal("policies/rules/checks-catalog.yaml");
    expect(MACHINE_WRITTEN_POLICY_PATHS).to.include("policies/rules/rules.yaml");
  });

  it("the command reference has ONE home, and it exists (no old-path fallback — T15)", () => {
    expect(REFERENCE_DOC_CANDIDATES).to.deep.equal(["../../content/framework/common/reference/gov-command-reference.md"]);
    expect(fs.existsSync(path.join(PKG, REFERENCE_DOC_CANDIDATES[0]!))).to.equal(true);
  });
});

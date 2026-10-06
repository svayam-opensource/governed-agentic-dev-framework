// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * framework/config/org-config.schema.yaml — the framework owns the SHAPE of org-config.yaml, the org owns the
 * values (org-config split, Policy Owner 2026-10-06). The schema ships scaffold-auto; `gov doctor` and the loader
 * check an org's file against it. These tests hold the shipped file to the reader, so the two cannot drift.
 */
import { expect } from "chai";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import {
  BUILT_IN_ORG_CONFIG_SCHEMA, ORG_CONFIG_SERVICE_KEYS, parseOrgConfigSchema, validateOrgConfig, defaultWorkRoot,
} from "../../src/config/org-config.js";
import { parseManifest } from "../../src/maintain/upgrade-sync.js";

const CONTENT = fileURLToPath(new URL("../../../../content/", import.meta.url));
const SCHEMA_PATH = "framework/config/org-config.schema.yaml";
const shipped = (): string => fs.readFileSync(path.join(CONTENT, SCHEMA_PATH), "utf8");

describe("gov-work — the org-config schema (framework/config/org-config.schema.yaml)", () => {
  it("ships, and the MANIFEST overwrites it on every upgrade (scaffold-auto)", () => {
    const m = parseManifest(fs.readFileSync(path.join(CONTENT, "MANIFEST.yaml"), "utf8"));
    const e = m.files.find((f) => f.dst === SCHEMA_PATH || (f.dst.endsWith("/") && SCHEMA_PATH.startsWith(f.dst)));
    expect(e, "the schema is in the MANIFEST").to.not.equal(undefined);
    expect(e!.mode).to.equal("scaffold-auto");
  });

  it("names exactly the keys the reader reads, requires what it requires, and lists what was retired", () => {
    const s = parseOrgConfigSchema(shipped());
    expect(s, "the shipped schema parses").to.not.equal(null);
    expect([...s!.keys].sort()).to.deep.equal([...BUILT_IN_ORG_CONFIG_SCHEMA.keys].sort());
    expect([...s!.required].sort()).to.deep.equal([...BUILT_IN_ORG_CONFIG_SCHEMA.required].sort());
    expect(s!.replaced).to.deep.equal(BUILT_IN_ORG_CONFIG_SCHEMA.replaced);
    expect(Object.keys(s!.retired).sort()).to.deep.equal(Object.keys(BUILT_IN_ORG_CONFIG_SCHEMA.retired).sort());
  });

  it("documents every key under services:", () => {
    const doc = shipped();
    for (const k of ORG_CONFIG_SERVICE_KEYS) expect(doc, k).to.match(new RegExp(`^\\s+${k}:`, "m"));
  });

  it("keeps identity and infrastructure only", () => {
    const keys = BUILT_IN_ORG_CONFIG_SCHEMA.keys;
    for (const k of ["org_name", "org_short_name", "org_slug", "org_repo_url", "github_org", "org_gov_repo", "default_branch", "default_code_branch", "services", "gov_account"]) {
      expect(keys, k).to.include(k);
    }
  });
});

describe("gov-work — validateOrgConfig", () => {
  const FULL = [
    'org_name: "Acme"', 'org_short_name: "Acme"', 'org_slug: "ACM"', 'org_repo_url: "git@github.com:acme/gov.git"',
    'github_org: "acme"', 'org_gov_repo: "gov"', 'default_branch: "main"', 'default_code_branch: "dev"',
  ].join("\n");

  it("a complete file is clean", () => {
    expect(validateOrgConfig(FULL)).to.deep.equal({ unknown: [], missing: [], retired: [], replaced: [] });
  });

  it("names a missing or empty required key", () => {
    expect(validateOrgConfig(FULL.replace('org_short_name: "Acme"', 'org_short_name: ""').replace(/^default_branch.*$/m, "")).missing)
      .to.deep.equal(["org_short_name", "default_branch"]);
  });

  it("a required key under its old name is renamed, not missing", () => {
    const r = validateOrgConfig(FULL.replace('org_gov_repo: "gov"', 'workspace_repo: "gov"'));
    expect(r.missing).to.deep.equal([]);
    expect(r.replaced).to.deep.equal([{ key: "workspace_repo", by: "org_gov_repo" }]);
  });

  it("an unknown key, and a retired one with where it went", () => {
    const r = validateOrgConfig(`${FULL}\nrequire_two_approvals: true\npolicy_owner_github: "po"\n`);
    expect(r.unknown).to.deep.equal(["require_two_approvals"]);
    expect(r.retired).to.deep.equal([{ key: "policy_owner_github", movedTo: "policies/governance.yaml (policy_owner.github)" }]);
  });

  it("checks against the workspace's own schema when it is given one", () => {
    const s = parseOrgConfigSchema("keys:\n  org_name: { type: string, required: true }\n  extra: { type: string }\n");
    expect(validateOrgConfig("extra: x\nother: y\n", s!)).to.deep.equal({ unknown: ["other"], missing: ["org_name"], retired: [], replaced: [] });
  });

  it("an unreadable schema is no schema — the caller falls back to the built-in one", () => {
    expect(parseOrgConfigSchema("keys: [unclosed")).to.equal(null);
    expect(parseOrgConfigSchema("")).to.equal(null);
  });
});

describe("gov-work — defaultWorkRoot", () => {
  it("is ~/.gov/<slug>/projects, beside the governance repo", () => {
    expect(defaultWorkRoot("SVM")).to.equal("~/.gov/svm/projects");
    expect(defaultWorkRoot("")).to.equal("");
  });
});

// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * WHAT GOV IGNORES IN org-config.yaml, AND THAT IT SAYS SO (PRJ-121, 2026-09-27).
 *
 * Two things are under test. First the behaviour: an invented key is reported, a key gov reads is not, and
 * nothing about a block gov reads is reported. Second the LIST — the claim that it cannot drift from the
 * reader. The type system carries most of that (`get()` takes `OrgConfigScalarKey`), so this suite reads the
 * reader's own source text to catch the ways round it: a widened signature, or a key read by some other
 * spelling.
 */
import { expect } from "chai";
import * as fs from "node:fs";
import { fileURLToPath } from "node:url";
import { ORG_CONFIG_KEYS, ORG_CONFIG_SERVICE_KEYS, RETIRED_ORG_CONFIG_KEYS, unknownOrgConfigKeys } from "../../src/config/org-config.js";
import { renderOrgConfig, deriveOrgConfig } from "../../src/setup/setup.js";

const READER_SRC = fs.readFileSync(fileURLToPath(new URL("../../src/config/org-config.ts", import.meta.url)), "utf8");

describe("gov-work — org-config unknown keys", () => {
  it("reports a key gov does not read, and keeps its order", () => {
    const text = [
      'org_name: "Acme"',
      "require_two_approvals: true",
      'default_branch: "main"',
      "foo: bar",
    ].join("\n");
    expect(unknownOrgConfigKeys(text)).to.deep.equal(["require_two_approvals", "foo"]);
  });

  it("says nothing about the keys gov reads — every one of them", () => {
    const text = ORG_CONFIG_KEYS.map((k) => `${k}: "x"`).join("\n");
    expect(unknownOrgConfigKeys(text)).to.deep.equal([]);
  });

  it("ignores comments, blank lines, document markers and list items", () => {
    const text = [
      "# require_two_approvals: true   ← a comment is not a key",
      "---",
      "",
      "   # an indented comment",
      "- not_a_key: 1",
      'org_slug: "SVM"',
      "...",
    ].join("\n");
    expect(unknownOrgConfigKeys(text)).to.deep.equal([]);
  });

  it("ignores everything nested under a block gov reads — the block's own parser owns it", () => {
    const text = [
      "services:",
      '  vault: "https://vault.example.com"',
      '  something_else: "x"',
      "repo_overrides:",
      "  upstream/repo: ours/repo",
      "env_branches:",
      "  - uat",
      "  - sit",
      "session:",
      "  access_ttl_sec: 300",
    ].join("\n");
    expect(unknownOrgConfigKeys(text)).to.deep.equal([]);
  });

  it("reports an unknown BLOCK by its heading, once, however deep it goes", () => {
    const text = ["approvals:", "  two: true", "  who:", "    - a", "approvals:", "  two: false"].join("\n");
    expect(unknownOrgConfigKeys(text)).to.deep.equal(["approvals"]);
  });

  it("finds nothing unknown in the file gov itself writes (`gov setup`)", () => {
    const values = deriveOrgConfig(
      { orgName: "Acme", orgSlug: "ACM", policyOwnerGithub: "@someone" },
      { originUrl: "git@github.com:Acme/acme-gov.git", ghUser: "someone", gitEmail: "a@b.c", today: "2026-09-27" },
    );
    expect(unknownOrgConfigKeys(renderOrgConfig(values))).to.deep.equal([]);
  });

  it("an empty file is not a problem", () => {
    expect(unknownOrgConfigKeys("")).to.deep.equal([]);
    expect(unknownOrgConfigKeys("\n\n   \n")).to.deep.equal([]);
  });
});

describe("gov-work — the key list cannot drift from the reader", () => {
  it("every key the reader asks `get()` for is on the published list", () => {
    const asked = [...READER_SRC.matchAll(/\bget\("([^"]+)"\)/g)].map((m) => m[1]!);
    expect(asked, "the reader should read something").to.not.be.empty;
    for (const key of asked) expect(ORG_CONFIG_KEYS, `get("${key}") is not on ORG_CONFIG_KEYS`).to.include(key);
  });

  it("every key the reader asks `svc()` for is on the services list", () => {
    const asked = [...READER_SRC.matchAll(/\bsvc\("([^"]+)"\)/g)].map((m) => m[1]!);
    for (const key of asked) expect([...ORG_CONFIG_SERVICE_KEYS], `svc("${key}") is not on ORG_CONFIG_SERVICE_KEYS`).to.include(key);
  });

  it("every top-level list the reader parses is on the published list", () => {
    const asked = [...READER_SRC.matchAll(/readTopLevelList\(text,\s*"([^"]+)"\)/g)].map((m) => m[1]!);
    for (const key of asked) expect(ORG_CONFIG_KEYS, `readTopLevelList "${key}" is not on ORG_CONFIG_KEYS`).to.include(key);
  });

  // The type is what makes the list binding; this test is what makes the type stay. Widening `get` to
  // `(key: string)` would silently reopen the drift the list exists to close.
  it("`get` and `svc` are typed to the list, not to `string`", () => {
    expect(READER_SRC).to.match(/const get = \(key: OrgConfigScalarKey\)/);
    expect(READER_SRC).to.match(/const svc = \(key: OrgConfigServiceKey\)/);
    expect(READER_SRC).to.match(/function readServiceScalar\(text: string, key: OrgConfigServiceKey\)/);
  });

  it("names none of the keys that left in the split — those are on the retired list, with where each went", () => {
    for (const k of ["policy_owner_github", "policy_owner_email", "check_owner_github", "governance_posture", "authorized_agents",
      "knowledge_publication", "legal_owner_github", "infra_owner_github", "system_arch_owner_github", "data_arch_owner_github",
      "policy_effective_date", "agent_work_root", "org_slug_lower", "authorized_approvers"]) {
      expect(ORG_CONFIG_KEYS, k).to.not.include(k);
      expect(RETIRED_ORG_CONFIG_KEYS, k).to.have.property(k);
    }
  });
});

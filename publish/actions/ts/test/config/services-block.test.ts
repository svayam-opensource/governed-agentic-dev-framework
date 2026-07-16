// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
// The org-level `services:` block: parsed into typed fields + a map, and PRESERVED (not clobbered) by upgrade.
import { expect } from "chai";
import { parseOrgConfig } from "../../src/config/org-config.js";
import { mergeOrgConfig } from "../../src/maintain/upgrade-sync.js";

const cfg = `org_name: "Acme"
agent_work_root: "~/work"
gov_account: "1000"
services:
  vault: "https://vault.acme.com"
  oidc: "https://oidc.acme.com"
  jenkins: "https://ci.acme.com"
  npm: "https://npm.acme.com"
`;

describe("org-config services block + upgrade merge", () => {
  it("parseOrgConfig reads services.* → vaultAddr/oidcBase + a services map + gov_account", () => {
    const o = parseOrgConfig(cfg);
    expect(o.vaultAddr).to.equal("https://vault.acme.com");
    expect(o.oidcBase).to.equal("https://oidc.acme.com");
    expect(o.services.jenkins).to.equal("https://ci.acme.com");
    expect(o.services.npm).to.equal("https://npm.acme.com");
    expect(o.govAccount).to.equal("1000");
  });

  it("vault_addr (legacy top-level) still wins/works when present", () => {
    expect(parseOrgConfig(`vault_addr: "https://legacy.vault"\n`).vaultAddr).to.equal("https://legacy.vault");
  });

  // DEFENSE CASE — an upgrade must NOT overwrite the org's NESTED endpoints with the template's placeholders.
  it("mergeOrgConfig preserves the org's nested services values over the template schema", () => {
    const template = `org_name: ""
agent_work_root: ""
gov_account: ""
services:
  vault: ""
  oidc: ""
  jenkins: ""
  npm: ""
  docker: ""
`;
    const merged = mergeOrgConfig(template, cfg);
    expect(merged, merged).to.match(/vault: "https:\/\/vault\.acme\.com"/);
    expect(merged).to.match(/oidc: "https:\/\/oidc\.acme\.com"/);
    expect(merged).to.match(/jenkins: "https:\/\/ci\.acme\.com"/);
    expect(merged).to.match(/gov_account: "1000"/);          // top-level org value preserved
    expect(merged).to.match(/docker: ""/);                    // NEW template key added (org didn't have it)
  });
});

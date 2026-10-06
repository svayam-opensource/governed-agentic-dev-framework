// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
// The org-level `services:` block: parsed into typed fields + a map, and PRESERVED (not clobbered) by upgrade.
import { expect } from "chai";
import { parseOrgConfig } from "../../src/config/org-config.js";
import { splitOrgConfig } from "../../src/maintain/org-config-split.js";

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

  // DEFENSE CASE — an upgrade must NOT touch the org's NESTED endpoints. The template merge that once risked it is
  // gone (org-config split); the one migration that still edits org-config.yaml leaves services: byte for byte.
  it("the org-config split leaves the org's nested services values exactly as they were", () => {
    const out = splitOrgConfig({ orgConfig: `${cfg}policy_owner_github: "po"\n`, governance: null, roleList: null });
    for (const line of cfg.split("\n").filter((l) => l && !l.startsWith("agent_work_root"))) expect(out.orgConfig.split("\n"), line).to.include(line);
    expect(out.orgConfig).to.not.match(/policy_owner_github/);
  });
});

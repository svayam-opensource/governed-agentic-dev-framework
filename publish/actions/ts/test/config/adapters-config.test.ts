// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * `adapters:` IN org-config.yaml (PRJ-121 intent 03, Q15). Which platform answers each port is a deployment fact,
 * so it lives with the other infrastructure. Missing → github for every port; a bad id → `gov doctor` fails and
 * names it.
 */
import { expect } from "chai";
import { parseOrgConfig, parseAdapterSelection, ORG_CONFIG_KEYS, unknownOrgConfigKeys } from "../../src/config/org-config.js";
import { doctor, type DoctorFacts } from "../../src/maintain/doctor.js";
import type { ResolveResult } from "../../src/resolve/types.js";

const FULL = [
  'org_name: "Acme"', 'org_short_name: "Acme"', 'org_slug: "ACM"', 'org_repo_url: "git@github.com:acme/gov.git"',
  'github_org: "acme"', 'org_gov_repo: "gov"', 'default_branch: "main"', 'default_code_branch: "dev"', "",
].join("\n");

const resolved: ResolveResult = { ok: true, home: "/gov", org: "acme", via: "active-org" };
const facts = (over: Partial<DoctorFacts> = {}): DoctorFacts => ({
  gitPresent: true, ghPresent: true, resolve: resolved, activeOrg: "acme", cliVersion: "1.0.0", workspaceChecked: true, ...over,
});
const row = (text: string) => doctor(facts({ orgConfigText: text })).diagnostics.find((d) => d.name === "adapters");

describe("org-config — adapters:", () => {
  it("is a key gov reads (never reported unknown)", () => {
    expect(ORG_CONFIG_KEYS).to.include("adapters");
    expect(unknownOrgConfigKeys(`${FULL}adapters:\n  vcs: github\n`)).to.deep.equal([]);
  });

  it("missing block → github for every port, and no problems", () => {
    expect(parseOrgConfig(FULL, "/h").adapters).to.deep.equal({ workTracker: "github", vcs: "github", ciIdentity: "github" });
    expect(parseAdapterSelection(FULL).problems).to.deep.equal([]);
  });

  it("an empty block, or a port left out, is github too", () => {
    expect(parseOrgConfig(`${FULL}adapters:\n`, "/h").adapters.vcs).to.equal("github");
    expect(parseOrgConfig(`${FULL}adapters:\n  vcs: github\n`, "/h").adapters.ciIdentity).to.equal("github");
  });

  it("reads each port by its snake_case key", () => {
    const s = parseAdapterSelection(`${FULL}adapters:\n  work_tracker: github\n  vcs: "github"  # the host\n  ci_identity: github\n`);
    expect(s.selection).to.deep.equal({ workTracker: "github", vcs: "github", ciIdentity: "github" });
    expect(s.problems).to.deep.equal([]);
  });

  it("a bad id is kept as written (the registry then refuses it by name) and reported", () => {
    const s = parseAdapterSelection(`${FULL}adapters:\n  vcs: gitlab\n`);
    expect(s.selection.vcs).to.equal("gitlab");
    expect(s.problems.join("\n")).to.contain("gitlab").and.contain("vcs");
  });

  it("an unknown port under adapters: is reported", () => {
    expect(parseAdapterSelection(`${FULL}adapters:\n  issue_tracker: jira\n`).problems.join()).to.contain("issue_tracker");
  });

  it("a block that is not a map is reported", () => {
    expect(parseAdapterSelection(`${FULL}adapters: github\n`).problems.join()).to.contain("adapters");
  });
});

describe("gov doctor — adapters row", () => {
  it("no block → no row (github is the default; nothing to say)", () => {
    expect(row(FULL)).to.equal(undefined);
  });

  it("a good block → ok, naming what answers each port", () => {
    const r = row(`${FULL}adapters:\n  vcs: github\n`)!;
    expect(r.status).to.equal("ok");
    expect(r.detail).to.contain("github");
  });

  it("a bad id → fail, naming the id and the port, and the report fails", () => {
    const report = doctor(facts({ orgConfigText: `${FULL}adapters:\n  ci_identity: circleci\n` }));
    const r = report.diagnostics.find((d) => d.name === "adapters")!;
    expect(r.status).to.equal("fail");
    expect(r.detail).to.contain("circleci").and.contain("ci_identity");
    expect(report.ok).to.equal(false);
  });
});

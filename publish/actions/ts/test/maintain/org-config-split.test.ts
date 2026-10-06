// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * THE ORG-CONFIG SPLIT, as `gov upgrade` runs it on an organization set up before it (Policy Owner, 2026-10-06).
 *
 * The values move ONCE: governance choices to policies/governance.yaml, domain owners to the role list, the work root
 * to the person's own machine. The loss guard must count a value the migration MOVED as carried, never as lost — and
 * must refuse, writing nothing, when anything gov reads would really be lost.
 *
 * The fixture is Svayam's real org-config.yaml (svm-prj-work, 2026-10-06), handles kept, the email redacted.
 */
import { expect } from "chai";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { splitOrgConfig, splitLoss } from "../../src/maintain/org-config-split.js";
import { parseOrgConfig, validateOrgConfig } from "../../src/config/org-config.js";
import { parseGovernance, renderGovernance, EMPTY_GOVERNANCE_VALUES, GOVERNANCE_PATH } from "../../src/config/governance.js";
import { parseRoleList, ROLE_LIST_PATH } from "../../src/config/role-list.js";
import { runUpgradeSync, doneMoves } from "../../src/maintain/upgrade-run.js";
import { readWorkRoot } from "../../src/config/work-root.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SVAYAM = fs.readFileSync(path.join(HERE, "fixtures", "svayam-org-config.yaml"), "utf8");
const CONTENT = fileURLToPath(new URL("../../../../content/", import.meta.url));
const TEMPLATE_GOV = renderGovernance(EMPTY_GOVERNANCE_VALUES);
const TEMPLATE_ROLES = fs.readFileSync(path.join(CONTENT, ROLE_LIST_PATH), "utf8");

describe("gov-work — the org-config split (upgrade migration `org-config-split`)", () => {
  it("SVAYAM: every value moves, nothing is lost, and org-config keeps identity and infrastructure only", () => {
    const r = splitOrgConfig({ orgConfig: SVAYAM, governance: TEMPLATE_GOV, roleList: TEMPLATE_ROLES });
    expect(splitLoss({ orgConfig: SVAYAM, governance: TEMPLATE_GOV, roleList: TEMPLATE_ROLES }, r), "ZERO loss").to.deep.equal([]);

    const g = parseGovernance(r.governance);
    expect(g.problems).to.deep.equal([]);
    expect(g.policyOwner).to.deep.equal({ email: "policy-owner@example.invalid", github: "svayam-rkant" });
    expect(g.posture.posture).to.equal("soft");

    const roles = parseRoleList(r.roleList!);
    expect(roles.found).to.equal(true);
    if (roles.found) {
      expect(roles.problems).to.deep.equal([]);
      expect(roles.roles.map((x) => [x.role, x.holder])).to.deep.equal([
        ["Legal Owner", "@svayam-rkant"], ["Infrastructure Owner", "@svayam-rkant"],
        ["System Architecture Owner", "@svayam-rkant"], ["Data Architecture Owner", "@svayam-rkant"],
      ]);
    }

    // What stays, byte for byte where it was not moved.
    const after = parseOrgConfig(r.orgConfig, "/h");
    const before = parseOrgConfig(SVAYAM, "/h");
    expect({ ...after, keyReport: null }).to.deep.equal({ ...before, keyReport: null });
    expect(after.workspaceRepo).to.equal("svm-prj-work");
    expect(r.orgConfig).to.match(/^org_gov_repo: "svm-prj-work"$/m);
    expect(validateOrgConfig(r.orgConfig), "the result passes the schema").to.deep.equal({ unknown: [], missing: [], retired: [], replaced: [] });
    for (const line of ['org_name: "Svayam Infoware Private Limited"', 'gov_account: "1000"', '  vault: "https://vault.svayamtech.com"', '  docker: "https://docker.svayamtech.com"']) {
      expect(r.orgConfig.split("\n"), line).to.include(line);
    }
    // ~/.gov/svm/projects IS the default, so there is nothing to record for anyone.
    expect(r.workRoot).to.equal(null);
    // The effective date has no home any more; it stays visible as a comment rather than vanishing.
    expect(r.orgConfig).to.match(/^# policy_effective_date: "2026-05-15"$/m);
  });

  it("is idempotent: run on its own output it changes nothing", () => {
    const once = splitOrgConfig({ orgConfig: SVAYAM, governance: TEMPLATE_GOV, roleList: TEMPLATE_ROLES });
    const twice = splitOrgConfig({ orgConfig: once.orgConfig, governance: once.governance, roleList: once.roleList });
    expect(twice.changed).to.equal(false);
    expect(twice.orgConfig).to.equal(once.orgConfig);
  });

  it("carries a hard posture, a Check Owner, the agents and knowledge publication", () => {
    const cfg = [
      'org_name: "Acme"', 'org_slug: "ACM"', 'github_org: "acme"', 'org_gov_repo: "gov"',
      'governance_posture: "hard"', 'policy_owner_github: "po"', 'check_owner_github: "@ck"',
      "authorized_agents:", '  default: "claude-code"', '  agent1: "cursor"', 'knowledge_publication: "site"', "",
    ].join("\n");
    const r = splitOrgConfig({ orgConfig: cfg, governance: TEMPLATE_GOV, roleList: null });
    expect(splitLoss({ orgConfig: cfg, governance: TEMPLATE_GOV, roleList: null }, r)).to.deep.equal([]);
    const g = parseGovernance(r.governance);
    expect(g.posture.posture).to.equal("hard");
    expect(g.checkOwner.github).to.equal("@ck");
    expect(g.knowledgePublication).to.equal("site");
    expect(g.authorizedAgents).to.deep.equal({ kind: "agents", agents: [{ id: "claude-code", default: true }, { id: "cursor" }] });
    expect(r.orgConfig).to.not.match(/authorized_agents|cursor|governance_posture|check_owner/);
  });

  it("carries `authorized_agents: none` as the decision it is", () => {
    const cfg = 'org_name: "Acme"\nauthorized_agents: none\n';
    const r = splitOrgConfig({ orgConfig: cfg, governance: TEMPLATE_GOV, roleList: null });
    expect(parseGovernance(r.governance).authorizedAgents.kind).to.equal("none");
  });

  it("a work root other than the default is handed back for this person's machine", () => {
    const r = splitOrgConfig({ orgConfig: 'org_slug: "ACM"\nagent_work_root: "~/src/acme"\n', governance: TEMPLATE_GOV, roleList: null });
    expect(r.workRoot).to.equal("~/src/acme");
    expect(r.orgConfig).to.not.match(/agent_work_root/);
  });

  it("REFUSES when governance.yaml already says something different — that value would be lost", () => {
    const gov = TEMPLATE_GOV.replace(/policy_owner:\n {2}email: ""\n {2}github: ""/, 'policy_owner:\n  email: ""\n  github: "someone-else"');
    const cfg = 'org_name: "Acme"\npolicy_owner_github: "po"\n';
    const r = splitOrgConfig({ orgConfig: cfg, governance: gov, roleList: null });
    expect(splitLoss({ orgConfig: cfg, governance: gov, roleList: null }, r)).to.deep.equal(["policy_owner_github (\"po\")"]);
  });

  it("a domain owner with no role table to go to is a loss, not a silent drop", () => {
    const cfg = 'org_name: "Acme"\nlegal_owner_github: "lee"\n';
    const r = splitOrgConfig({ orgConfig: cfg, governance: TEMPLATE_GOV, roleList: "# no table here\n" });
    expect(splitLoss({ orgConfig: cfg, governance: TEMPLATE_GOV, roleList: "# no table here\n" }, r)).to.deep.equal([]);
    // …because the migration ADDS the table when there is none.
    const roles = parseRoleList(r.roleList!);
    expect(roles.found && roles.roles.find((x) => x.role === "Legal Owner")?.holder).to.equal("@lee");
  });

  it("a role table that already names a holder keeps it — the table was already the authority", () => {
    const table = "| Role | GitHub handle | Owns |\n|---|---|---|\n| Legal Owner | @tabled | `knowledge/legal/` |\n";
    const cfg = 'org_name: "Acme"\nlegal_owner_github: "lee"\n';
    const r = splitOrgConfig({ orgConfig: cfg, governance: TEMPLATE_GOV, roleList: table });
    expect(r.roleList).to.equal(table);
    expect(splitLoss({ orgConfig: cfg, governance: TEMPLATE_GOV, roleList: table }, r)).to.deep.equal([]);
  });
});

describe("gov-work — `gov upgrade --apply` on a Svayam-shaped workspace (end to end)", () => {
  let ws: string;
  let home: string;
  beforeEach(() => {
    ws = fs.mkdtempSync(path.join(os.tmpdir(), "gov-split-ws-"));
    home = fs.mkdtempSync(path.join(os.tmpdir(), "gov-split-home-"));
    fs.writeFileSync(path.join(ws, "org-config.yaml"), SVAYAM);
  });
  afterEach(() => { fs.rmSync(ws, { recursive: true, force: true }); fs.rmSync(home, { recursive: true, force: true }); });

  it("moves every value, records the migration once, and leaves a workspace doctor finds clean", () => {
    const res = runUpgradeSync(CONTENT, ws, { apply: true, userHome: home });
    expect(res.code, res.lines.join("\n")).to.equal(0);
    expect(doneMoves(ws)).to.include("org-config.yaml → policies/governance.yaml");

    const g = parseGovernance(fs.readFileSync(path.join(ws, GOVERNANCE_PATH), "utf8"));
    expect(g.policyOwner.github).to.equal("svayam-rkant");
    const cfg = fs.readFileSync(path.join(ws, "org-config.yaml"), "utf8");
    expect(validateOrgConfig(cfg)).to.deep.equal({ unknown: [], missing: [], retired: [], replaced: [] });
    const roles = parseRoleList(fs.readFileSync(path.join(ws, ROLE_LIST_PATH), "utf8"));
    expect(roles.found && roles.roles.every((r) => r.holder === "@svayam-rkant")).to.equal(true);
    expect(fs.readFileSync(path.join(ws, "CODEOWNERS"), "utf8")).to.match(/^\/policies\/governance\.yaml\s+@svayam-rkant$/m);
    expect(readWorkRoot("Svayamtech", home), "the default needs no record").to.equal(null);

    // A second upgrade does not run it again.
    const again = runUpgradeSync(CONTENT, ws, { apply: false, userHome: home });
    expect(again.lines.join("\n")).to.not.match(/org-config-split|migrate/);
  });

  it("records a non-default work root for the person who runs it", () => {
    fs.writeFileSync(path.join(ws, "org-config.yaml"), SVAYAM.replace('agent_work_root: "~/.gov/svm/projects"', 'agent_work_root: "~/code/svm"'));
    const res = runUpgradeSync(CONTENT, ws, { apply: true, userHome: home });
    expect(res.code, res.lines.join("\n")).to.equal(0);
    expect(readWorkRoot("Svayamtech", home)).to.equal("~/code/svm");
  });

  it("refuses the whole migration — org-config untouched — when a value would be lost", () => {
    fs.mkdirSync(path.join(ws, "policies"), { recursive: true });
    fs.writeFileSync(path.join(ws, GOVERNANCE_PATH), TEMPLATE_GOV.replace('github: ""\n\n# THE CHECK', 'github: "not-svayam"\n\n# THE CHECK'));
    const dry = runUpgradeSync(CONTENT, ws, { apply: false, userHome: home });
    expect(dry.lines.join("\n")).to.match(/refuse/);
    const res = runUpgradeSync(CONTENT, ws, { apply: true, userHome: home });
    expect(res.code).to.equal(1);
    expect(fs.readFileSync(path.join(ws, "org-config.yaml"), "utf8")).to.equal(SVAYAM);
    expect(doneMoves(ws)).to.not.include("org-config.yaml → policies/governance.yaml");
  });
});

// Policy Owner, 2026-10-06: gov never changes what the org WROTE under policies/ — it writes there only to seed a file
// once, and once, in a recorded upgrade migration, to fill values that were empty.
describe("GOV-FRM-445 — the migration fills only what is empty under policies/", () => {
  it("GOV-FRM-445 a value the organization already wrote in governance.yaml is never replaced by org-config's", () => {
    const written = TEMPLATE_GOV.replace(/(policy_owner:[\s\S]*?github:\s*)""/, '$1"@alice"').replace(/governance_posture:\s*\S+/, "governance_posture: hard");
    const cfg = 'org_slug: "SVM"\npolicy_owner_github: "@bob"\ngovernance_posture: "soft"\n';
    const out = splitOrgConfig({ orgConfig: cfg, governance: written, roleList: null });
    const g = parseGovernance(out.governance);
    expect(g.policyOwner.github.replace(/^@/, "")).to.equal("alice");
    expect(g.posture.posture).to.equal("hard");
  });

  it("GOV-FRM-445 a role holder the organization already named in the role list is never replaced", () => {
    const named = TEMPLATE_ROLES.replace("<LEGAL_OWNER_GITHUB>", "@lena");
    const out = splitOrgConfig({ orgConfig: 'org_slug: "SVM"\nlegal_owner_github: "@larry"\n', governance: TEMPLATE_GOV, roleList: named });
    const legal = parseRoleList(out.roleList ?? "").roles.find((r) => r.role === "Legal Owner");
    expect(legal?.holder?.replace(/^@/, "")).to.equal("lena");
  });

  it("GOV-FRM-445 an empty placeholder IS filled from org-config — the one write the promise allows", () => {
    const out = splitOrgConfig({ orgConfig: 'org_slug: "SVM"\npolicy_owner_github: "@bob"\n', governance: TEMPLATE_GOV, roleList: null });
    expect(parseGovernance(out.governance).policyOwner.github.replace(/^@/, "")).to.equal("bob");
  });
});


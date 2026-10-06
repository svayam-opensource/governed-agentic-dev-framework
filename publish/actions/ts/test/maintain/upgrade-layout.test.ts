// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * AN OLD-LAYOUT WORKSPACE, UPGRADED (PRJ-121, 2026-09-23).
 *
 * The split — `governance/` into `framework/` (the framework's) + `policies/` (the org's) — is only safe if an
 * organization's OWN files come across: its approved exceptions, its curated knowledge standard, its authorized
 * agents. This runs the real shipped content against a workspace in the old shape and checks exactly that.
 */
import { expect } from "chai";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { runUpgradeSync, doneMoves } from "../../src/maintain/upgrade-run.js";
import { parseAuthorizedAgents } from "../../src/config/approved-agents.js";
import { contentLayoutOf } from "../../src/maintain/upgrade-sync.js";

const contentDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../content");

/** A workspace as it was before the split, with the things that are the ORG's. */
function oldLayoutWorkspace(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gov-oldlayout-"));
  const put = (rel: string, text: string): void => {
    fs.mkdirSync(path.join(dir, path.dirname(rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), text);
  };
  put("org-config.yaml", 'org_name: "Acme"\ngithub_org: "acme"\nworkspace_repo: "acme-gov"\n');
  put("VERSION", "1.2.0\n");
  put("governance/policies/org-ai-agent-governance-policy.md", "# the old doctrine\n");
  put("governance/policies/knowledge-organization-standard.md", "# OUR taxonomy, curated over a year\n");
  put("governance/policies/exceptions/legal/retention.md", "# our approved exception\n");
  put("governance/policies/exceptions/policy/agent-use.md", "# another of ours\n");
  put("governance/infrastructure/knowledge-publication-spec.md", "# our publication rules\n");
  put("governance/policies/llm-governance.md", "### Approved\n\n```yaml\napproved_agents:\n  - id: ibm-bob\n    default: true\n  - id: claude\n```\n");
  put("knowledge/domains/ours.md", "# the org's knowledge, untouched by any of this\n");
  return dir;
}

describe("upgrade — a workspace on the old layout keeps everything that is the org's", function () {
  this.timeout(30000);
  let dir = "", result: { code: number; lines: string[] } = { code: -1, lines: [] };

  before(() => {
    dir = oldLayoutWorkspace();
    expect(contentLayoutOf((rel) => fs.existsSync(path.join(dir, rel))), "starts on the old layout").to.equal("governance");
    result = runUpgradeSync(contentDir, dir, { apply: true });
  });
  after(() => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* gone */ } });

  const read = (rel: string): string | null => {
    try { return fs.readFileSync(path.join(dir, rel), "utf8"); } catch { return null; /* not there is an answer */ }
  };

  it("succeeds, and lands the new layout", () => {
    expect(result.code, result.lines.join("\n")).to.equal(0);
    expect(contentLayoutOf((rel) => fs.existsSync(path.join(dir, rel)))).to.equal("framework");
    expect(read("framework/docs/specs/framework-specification.md"), "the framework's specification, at its new path").to.not.equal(null);
  });

  it("the org's APPROVED EXCEPTIONS come across, byte for byte, folder by folder", () => {
    expect(read("policies/exceptions/legal/retention.md")).to.equal("# our approved exception\n");
    expect(read("policies/exceptions/policy/agent-use.md")).to.equal("# another of ours\n");
    expect(read("governance/policies/exceptions/legal/retention.md"), "and are not left as a second copy").to.equal(null);
  });

  it("the org's CURATED STANDARD comes across as it stands — not re-seeded from the starter", () => {
    expect(read("policies/knowledge-organization-standard.md")).to.equal("# OUR taxonomy, curated over a year\n");
  });

  it("the org's PUBLICATION RULES come across — into the one file that now holds them", () => {
    // `knowledge-publication-spec.md` folded into `knowledge-publication.md` when the clauses moved: the
    // decision and the arrangement that carries it out are one document, not two (GOV-FRM-402).
    expect(read("policies/knowledge-publication.md")).to.equal("# our publication rules\n");
  });

  it("the org's AUTHORIZED AGENTS are carried into policies/governance.yaml, default and all", () => {
    const agents = parseAuthorizedAgents(read("policies/governance.yaml"));
    expect(agents?.map((a) => a.id)).to.have.members(["ibm-bob", "claude"]);
    expect(agents?.find((a) => a.default)?.id, "the org's default survives").to.equal("ibm-bob");
    expect(read("governance/policies/llm-governance.md"), "and the retired file is gone").to.equal(null);
  });

  it("the org's own KNOWLEDGE is not touched at all", () => {
    expect(read("knowledge/domains/ours.md")).to.equal("# the org's knowledge, untouched by any of this\n");
  });

  it("each relocation is recorded, so a second upgrade moves nothing again", () => {
    expect(doneMoves(dir).length, "recorded").to.be.greaterThan(0);
    const again = runUpgradeSync(contentDir, dir, { apply: true });
    expect(again.code).to.equal(0);
    expect(read("policies/knowledge-organization-standard.md"), "still the org's, not the starter").to.equal("# OUR taxonomy, curated over a year\n");
  });
});

// Policy Owner, 2026-10-07: the frozen policy snapshots move from `policies/version/` to `policies/history/`.
// Beside the file `policies/VERSION`, the folder `policies/version/` is the SAME name on a case-insensitive disk
// (macOS, Windows): a checkout makes only one of the two. So this workspace may hold the folder and no VERSION file
// at all — the state the sandbox reached on a Mac — and the upgrade must still land both, each in its own name.
describe("upgrade — the policy snapshots move from policies/version/ to policies/history/", function () {
  this.timeout(30000);
  let dir = "", result: { code: number; lines: string[] } = { code: -1, lines: [] };
  const put = (rel: string, text: string): void => {
    fs.mkdirSync(path.join(dir, path.dirname(rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), text);
  };
  const read = (rel: string): string | null => {
    try { return fs.readFileSync(path.join(dir, rel), "utf8"); } catch { return null; /* not there is an answer */ }
  };

  before(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "gov-history-"));
    put("org-config.yaml", 'org_name: "Acme"\ngithub_org: "acme"\norg_gov_repo: "acme-gov"\n');
    put("framework/docs/specs/framework-specification.md", "# old\n");
    put("policies/org-policy.md", "# Our policy, as it stands\n");
    put("policies/version/1.3.0/org-policy.md", "# Our policy, as it was at 1.3.0\n");
    put("policies/version/1.3.0/CHANGELOG.md", "# changelog at 1.3.0\n");
    result = runUpgradeSync(contentDir, dir, { apply: true });
  });
  after(() => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* gone */ } });

  it("succeeds", () => expect(result.code, result.lines.join("\n")).to.equal(0));

  it("every snapshot arrives under policies/history/, byte for byte, and nothing is left under the old folder", () => {
    expect(read("policies/history/1.3.0/org-policy.md")).to.equal("# Our policy, as it was at 1.3.0\n");
    expect(read("policies/history/1.3.0/CHANGELOG.md")).to.equal("# changelog at 1.3.0\n");
    const old = fs.readdirSync(path.join(dir, "policies")).filter((n) => n === "version");
    expect(old, "no folder named version/ is left beside VERSION").to.deep.equal([]);
  });

  it("policies/VERSION is a file again", () => {
    expect(fs.statSync(path.join(dir, "policies/VERSION")).isFile()).to.equal(true);
  });

  it("the move is recorded, and a second upgrade changes nothing", () => {
    expect(doneMoves(dir).some((m) => m.startsWith("policies/version/"))).to.equal(true);
    const again = runUpgradeSync(contentDir, dir, { apply: true });
    expect(again.code, again.lines.join("\n")).to.equal(0);
    expect(read("policies/history/1.3.0/org-policy.md")).to.equal("# Our policy, as it was at 1.3.0\n");
  });
});

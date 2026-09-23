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
    expect(read("framework/policies/framework-policy.md"), "the framework's doctrine, at its new path").to.not.equal(null);
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
    // decision and the arrangement that carries it out are one document, not two (POL-402).
    expect(read("policies/knowledge-publication.md")).to.equal("# our publication rules\n");
  });

  it("the org's AUTHORIZED AGENTS are carried into org-config.yaml, default and all", () => {
    const agents = parseAuthorizedAgents(read("org-config.yaml"));
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

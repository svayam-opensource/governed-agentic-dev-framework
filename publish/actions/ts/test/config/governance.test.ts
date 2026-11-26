// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * policies/governance.yaml — the organization's governance choices (org-config split, Policy Owner 2026-10-06).
 *
 * The shared contract: the shape below is fixed by the orchestrator, and `gov rules propose` reads
 * `modelSettings` through it. These tests pin the shape, the defaults, and the one file both setup and the
 * framework template must agree on.
 */
import { expect } from "chai";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import {
  GOVERNANCE_PATH, parseGovernance, readGovernance, modelSettings, renderGovernance, EMPTY_GOVERNANCE_VALUES,
  readPosture, classifyPosture, frameworkOwners, frameworkAlternates, describeGovernanceChanges, governanceTokens, CI_ALLOWED_RETIRED_NOTE,
} from "../../src/config/governance.js";
import { NO_APPROVED_MODEL } from "../../src/rules/propose/providers/index.js";

const CONTENT = fileURLToPath(new URL("../../../../content/", import.meta.url));

const FULL = `governance_posture: hard
policy_owner:
  email: "po@acme.test"
  github: "@po"
check_owner:
  github: "checker"
authorized_agents:
  default: "claude-code"
  agent1: "cursor"
knowledge_publication: site
models:
  propose:
    provider: anthropic
    model: "claude-opus-5-5"
  command: ""
  ci_allowed: true
`;

describe("gov-work — policies/governance.yaml (the org's governance choices)", () => {
  it("lives at policies/governance.yaml", () => {
    expect(GOVERNANCE_PATH).to.equal("policies/governance.yaml");
  });

  it("reads every field of the contract", () => {
    const g = parseGovernance(FULL);
    expect(g.posture.posture).to.equal("hard");
    expect(g.policyOwner).to.deep.equal({ email: "po@acme.test", github: "@po", alternates: [] });
    expect(g.checkOwner).to.deep.equal({ github: "checker", alternates: [] });
    expect(g.authorizedAgents).to.deep.equal({ kind: "agents", agents: [{ id: "claude-code", default: true }, { id: "cursor" }] });
    expect(g.problems).to.deep.equal([]);
  });

  it("accepts the flow style the contract is written in", () => {
    const g = parseGovernance([
      "governance_posture: soft",
      'policy_owner: { email: "a@b.c", github: "pa" }',
      'check_owner: { github: "pc" }',
      'authorized_agents: { default: "claude-code" }',
      "knowledge_publication: none",
      'models: { propose: { provider: command, model: "" }, command: "llm-cli --json", ci_allowed: false }',
    ].join("\n"));
    expect(g.policyOwner.github).to.equal("pa");
    expect(g.checkOwner.github).to.equal("pc");
    expect(g.authorizedAgents).to.deep.equal({ kind: "agents", agents: [{ id: "claude-code", default: true }] });
    expect(modelSettings(g)).to.deep.equal({ provider: "command", model: "", command: "llm-cli --json" });
  });

  it("an absent or empty file is soft, vacant, unset, none — and no model approved", () => {
    for (const text of [null, "", "# nothing\n"]) {
      const g = parseGovernance(text);
      expect(g.posture).to.deep.equal({ posture: "soft", raw: "", unrecognised: false });
      expect(g.policyOwner).to.deep.equal({ email: "", github: "", alternates: [] });
      expect(g.checkOwner).to.deep.equal({ github: "", alternates: [] });
      expect(g.authorizedAgents.kind).to.equal("unset");
      expect(modelSettings(g)).to.deep.equal({ provider: null, model: "", command: "" });
    }
  });

  it("modelSettings: anthropic, and an unknown provider (none approved, and said)", () => {
    expect(modelSettings(parseGovernance(FULL))).to.deep.equal({ provider: "anthropic", model: "claude-opus-5-5", command: "" });
    const odd = parseGovernance("models:\n  propose:\n    provider: openai\n    model: x\n");
    expect(modelSettings(odd).provider).to.equal(null);
    expect(odd.problems.join(" ")).to.match(/openai/);
  });

  it("Q68 A: models.ci_allowed is retired — ignored whatever its value, never a problem, one note that it can go", () => {
    for (const v of ["true", "false", "\"yes\""]) {
      const g = parseGovernance(`models:\n  propose: { provider: anthropic, model: m }\n  ci_allowed: ${v}\n`);
      expect(g.problems, v).to.deep.equal([]);
      expect(g.notes, v).to.deep.equal([CI_ALLOWED_RETIRED_NOTE]);
      expect(CI_ALLOWED_RETIRED_NOTE).to.equal("models.ci_allowed is no longer used — you can delete it");
      expect(modelSettings(g)).to.deep.equal({ provider: "anthropic", model: "m", command: "" });
    }
    expect(parseGovernance("models:\n  propose: { provider: anthropic, model: m }\n").notes).to.deep.equal([]);
  });

  it("Q68 A: the template, and the no-model message, no longer carry ci_allowed", () => {
    expect(renderGovernance(EMPTY_GOVERNANCE_VALUES)).to.not.contain("ci_allowed");
    expect(fs.readFileSync(path.join(CONTENT, GOVERNANCE_PATH), "utf8")).to.not.contain("ci_allowed");
    expect(NO_APPROVED_MODEL.join("\n")).to.not.contain("ci_allowed");
    expect(parseGovernance(renderGovernance(EMPTY_GOVERNANCE_VALUES)).notes).to.deep.equal([]);
  });
  it("gemini is a provider gov can call (Policy Owner, 2026-10-07); the template comment lists it", () => {
    const g = parseGovernance("models:\n  propose: { provider: gemini, model: gemini-org }\n");
    expect(modelSettings(g)).to.deep.include({ provider: "gemini", model: "gemini-org" });
    expect(g.problems).to.deep.equal([]);
    expect(renderGovernance(EMPTY_GOVERNANCE_VALUES)).to.contain("anthropic · gemini · command");
  });

  it("a posture it does not know is reported, never guessed", () => {
    const g = parseGovernance("governance_posture: strict\n");
    expect(g.posture).to.deep.equal({ posture: null, raw: "strict", unrecognised: true });
    expect(readPosture("governance_posture: strict\n").unrecognised).to.equal(true);
    expect(classifyPosture("HARD").posture).to.equal("hard");
  });

  it("broken YAML is a problem to report, not a crash — the defaults apply", () => {
    const g = parseGovernance("policy_owner: [unclosed\n");
    expect(g.problems[0]).to.match(/not valid YAML/);
    expect(g.posture.posture).to.equal("soft");
  });

  it("reports a key it does not read", () => {
    expect(parseGovernance("require_two_approvals: true\n").problems.join(" ")).to.match(/require_two_approvals/);
  });

  it("frameworkOwners gives the two built-in roles' handles", () => {
    expect(frameworkOwners(parseGovernance(FULL))).to.deep.equal({ policyOwner: "@po", checkOwner: "checker" });
  });

  it("governanceTokens fills the setup/seed tokens these values used to come from org-config", () => {
    const t = governanceTokens(parseGovernance(FULL));
    expect(t.POLICY_OWNER_EMAIL).to.equal("po@acme.test");
    expect(t.POLICY_OWNER_GITHUB).to.equal("@po");
    expect(t.CHECK_OWNER_GITHUB).to.equal("checker");
  });

  it("renderGovernance round-trips every value", () => {
    const text = renderGovernance({
      governancePosture: "hard", policyOwnerEmail: "po@acme.test", policyOwnerGithub: "@po", checkOwnerGithub: "@ck",
      defaultAgent: "claude-code",
    });
    const g = parseGovernance(text);
    expect(g.problems).to.deep.equal([]);
    expect(g.posture.posture).to.equal("hard");
    expect(frameworkOwners(g)).to.deep.equal({ policyOwner: "@po", checkOwner: "@ck" });
    expect(g.policyOwner.email).to.equal("po@acme.test");
    expect(g.authorizedAgents).to.deep.equal({ kind: "agents", agents: [{ id: "claude-code", default: true }] });
    expect(modelSettings(g)).to.deep.equal({ provider: null, model: "", command: "" });
  });

  it("THE SHIPPED TEMPLATE IS THE RENDERER'S EMPTY FILE — one source for the comments and the shape", () => {
    const shipped = fs.readFileSync(path.join(CONTENT, GOVERNANCE_PATH), "utf8");
    expect(shipped).to.equal(renderGovernance(EMPTY_GOVERNANCE_VALUES));
  });

  it("readGovernance reads the file under a workspace, and treats a missing one as absent", () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "gov-gov-"));
    try {
      expect(readGovernance(home).present).to.equal(false);
      fs.mkdirSync(path.join(home, "policies"));
      fs.writeFileSync(path.join(home, GOVERNANCE_PATH), FULL);
      const g = readGovernance(home);
      expect(g.present).to.equal(true);
      expect(g.policyOwner.github).to.equal("@po");
    } finally { fs.rmSync(home, { recursive: true, force: true }); }
  });
});

// POLICY OWNER RULING F163 B (PRJ-121, 2026-11-25): a role's list is its holder plus any number of alternates.
describe("policies/governance.yaml — alternates: one handle or a list (F163 B)", () => {
  const po = (alt: string) => `policy_owner:\n  github: "polly"\n${alt}\ncheck_owner:\n  github: "cora"\n`;

  it("a single string — every file written before F163, e.g. a proposal adding one alternate — still reads", () => {
    const g = parseGovernance(po('  alternate: "princy1511"'));
    expect(g.policyOwner.alternates).to.deep.equal(["@princy1511"]);
    expect(g.problems).to.deep.equal([]);
  });

  it("a YAML list, block or flow, under alternate: — the canonical key", () => {
    expect(parseGovernance(po('  alternate: ["ana", "@ben"]')).policyOwner.alternates).to.deep.equal(["@ana", "@ben"]);
    expect(parseGovernance(po("  alternate:\n    - ana\n    - ben")).policyOwner.alternates).to.deep.equal(["@ana", "@ben"]);
  });

  it("alternates: is read as the same thing, and merges with alternate:, once each", () => {
    expect(parseGovernance(po("  alternates: [ana, ben]")).policyOwner.alternates).to.deep.equal(["@ana", "@ben"]);
    expect(parseGovernance(po("  alternate: ana\n  alternates: [ben, ANA]")).policyOwner.alternates).to.deep.equal(["@ana", "@ben"]);
  });

  it("a comma-separated string reads as a list; the flow form of the block too", () => {
    expect(parseGovernance(po('  alternate: "ana, ben"')).policyOwner.alternates).to.deep.equal(["@ana", "@ben"]);
    const g = parseGovernance('check_owner: { github: "cora", alternate: [cy, dee] }\n');
    expect(frameworkAlternates(g)).to.deep.equal({ policyOwnerAlternates: [], checkOwnerAlternates: ["@cy", "@dee"] });
  });

  it("a handle gov cannot use is a problem, and the value reads as no alternate", () => {
    const g = parseGovernance(po('  alternate: ["ana", "not a handle!"]'));
    expect(g.policyOwner.alternates).to.deep.equal([]);
    expect(g.problems.join()).to.contain("policy_owner.alternate").and.contain('"handle!" is not a GitHub handle');
    const m = parseGovernance(po("  alternate: { who: ana }"));
    expect(m.problems.join()).to.contain("policy_owner.alternate: expected a handle or a list of handles");
  });

  it("describeGovernanceChanges names the whole list", () => {
    expect(describeGovernanceChanges(po('  alternate: "ana"'), po("  alternate: [ana, ben]"))).to.deep.equal(["Policy Owner's alternates: @ana → @ana, @ben"]);
  });
});

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
  readPosture, classifyPosture, frameworkOwners, governanceTokens,
} from "../../src/config/governance.js";

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
    expect(g.policyOwner).to.deep.equal({ email: "po@acme.test", github: "@po" });
    expect(g.checkOwner).to.deep.equal({ github: "checker" });
    expect(g.authorizedAgents).to.deep.equal({ kind: "agents", agents: [{ id: "claude-code", default: true }, { id: "cursor" }] });
    expect(g.knowledgePublication).to.equal("site");
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
    expect(modelSettings(g)).to.deep.equal({ provider: "command", model: "", command: "llm-cli --json", ciAllowed: false });
  });

  it("an absent or empty file is soft, vacant, unset, none — and no model approved", () => {
    for (const text of [null, "", "# nothing\n"]) {
      const g = parseGovernance(text);
      expect(g.posture).to.deep.equal({ posture: "soft", raw: "", unrecognised: false });
      expect(g.policyOwner).to.deep.equal({ email: "", github: "" });
      expect(g.checkOwner).to.deep.equal({ github: "" });
      expect(g.authorizedAgents.kind).to.equal("unset");
      expect(g.knowledgePublication).to.equal("none");
      expect(modelSettings(g)).to.deep.equal({ provider: null, model: "", command: "", ciAllowed: false });
    }
  });

  it("modelSettings: anthropic, an unknown provider (none approved, and said), ci_allowed only when literally true", () => {
    expect(modelSettings(parseGovernance(FULL))).to.deep.equal({ provider: "anthropic", model: "claude-opus-5-5", command: "", ciAllowed: true });
    const odd = parseGovernance("models:\n  propose:\n    provider: openai\n    model: x\n  ci_allowed: \"yes\"\n");
    expect(modelSettings(odd).provider).to.equal(null);
    expect(modelSettings(odd).ciAllowed).to.equal(false);
    expect(odd.problems.join(" ")).to.match(/openai/);
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
      defaultAgent: "claude-code", knowledgePublication: "none",
    });
    const g = parseGovernance(text);
    expect(g.problems).to.deep.equal([]);
    expect(g.posture.posture).to.equal("hard");
    expect(frameworkOwners(g)).to.deep.equal({ policyOwner: "@po", checkOwner: "@ck" });
    expect(g.policyOwner.email).to.equal("po@acme.test");
    expect(g.authorizedAgents).to.deep.equal({ kind: "agents", agents: [{ id: "claude-code", default: true }] });
    expect(modelSettings(g)).to.deep.equal({ provider: null, model: "", command: "", ciAllowed: false });
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

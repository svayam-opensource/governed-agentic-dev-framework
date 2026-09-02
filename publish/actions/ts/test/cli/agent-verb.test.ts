// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/** `gov agent` — report, and the install plan (#196). */
import { expect } from "chai";
import { agentReport, formatAgentReport, planAgentInstall } from "../../src/cli/agent-verb.js";

const has = (...cmds: string[]) => (c: string) => cmds.includes(c);

describe("gov-work — gov agent reports (#196)", () => {
  it("shows the org's list, marks the default, and says what is runnable", () => {
    const r = agentReport({
      approved: [{ id: "claude-code", default: true }, { id: "cursor" }],
      hasTool: has("claude"), env: {},
    });
    const text = formatAgentReport(r).join("\n");
    expect(text).to.contain("Approved by your organization");
    expect(text).to.contain("Claude Code  (default)");
    expect(text).to.contain("in the terminal");
    expect(text, "cursor is approved and absent").to.contain("not installed");
  });

  it("says when the org has not decided, rather than showing an empty list", () => {
    const text = formatAgentReport(agentReport({ approved: null, hasTool: () => false, env: {} })).join("\n");
    expect(text).to.contain("has not approved any agents yet");
  });

  it("an EMPTY block is a decision, and reads as one", () => {
    // Different from "no block": somebody decided on nothing.
    const text = formatAgentReport(agentReport({ approved: [], hasTool: () => false, env: {} })).join("\n");
    expect(text).to.contain("Nothing is approved");
    expect(text).to.contain("gov agent approve");
  });

  it("reports a missing key by its absence, never by reading one", () => {
    const without = formatAgentReport(agentReport({ approved: [{ id: "claude-code" }], hasTool: has("claude"), env: {} })).join("\n");
    const withKey = formatAgentReport(agentReport({ approved: [{ id: "claude-code" }], hasTool: has("claude"), env: { ANTHROPIC_API_KEY: "sk-x" } })).join("\n");
    expect(without).to.contain("no ANTHROPIC_API_KEY set");
    expect(withKey).to.not.contain("no ANTHROPIC_API_KEY set");
  });

  it("reports key drift without printing either copy", () => {
    const text = formatAgentReport(agentReport({
      approved: [{ id: "claude-code" }], hasTool: has("claude"),
      env: { ANTHROPIC_API_KEY: "sk-x" }, credentialDrift: () => true,
    })).join("\n");
    expect(text).to.contain("differs from the one the agent uses");
    expect(text).to.not.contain("sk-x");
  });

  it("says an extension needs a host, and that gov will not create one", () => {
    const text = formatAgentReport(agentReport({ approved: [{ id: "claude-code" }], hasTool: has("claude"), env: {} })).join("\n");
    expect(text).to.contain("gov will not install an editor");
  });

  it("flags an approved id it cannot launch anything for", () => {
    const text = formatAgentReport(agentReport({ approved: [{ id: "not-a-real-agent" }], hasTool: () => false, env: {} })).join("\n");
    expect(text).to.contain("approved but unknown to this version of gov");
  });
});

describe("gov-work — gov agent install (#196)", () => {
  it("refuses an agent the org has not approved, and says how to propose it", () => {
    const p = planAgentInstall("claude-code", [{ id: "cursor" }], () => false);
    expect(p.ok).to.equal(false);
    if (p.ok) return;
    expect(p.message).to.contain("not approved by your organization");
    expect(p.message).to.contain("gov agent approve claude-code");
  });

  it("installs an approved npm agent", () => {
    const p = planAgentInstall("claude-code", [{ id: "claude-code" }], () => false);
    expect(p.ok).to.equal(true);
    if (!p.ok) return;
    expect(p.steps[0]!.command).to.deep.equal(["npm", "install", "-g", "@anthropic-ai/claude-code"]);
    expect(p.signIn, "and knows how to sign in afterwards").to.deep.equal(["claude", "/login"]);
  });

  it("runs a vendor script too — approval IS the trust decision", () => {
    // Gating on npm-vs-curl would be gov second-guessing a reviewed decision by the
    // Infrastructure Owner (#196, Q2).
    const p = planAgentInstall("cursor", [{ id: "cursor" }], () => false);
    expect(p.ok).to.equal(true);
    if (!p.ok) return;
    expect(p.steps.map((s) => s.command[0])).to.include("sh");
  });

  it("installs an extension into a host that exists", () => {
    const p = planAgentInstall("claude-code", [{ id: "claude-code" }], has("code"));
    expect(p.ok).to.equal(true);
    if (!p.ok) return;
    expect(p.steps.some((s) => s.command.join(" ").includes("--install-extension anthropic.claude-code"))).to.equal(true);
  });

  it("never installs a host to satisfy an extension", () => {
    const p = planAgentInstall("claude-code", [{ id: "claude-code" }], () => false);
    expect(p.ok).to.equal(true);
    if (!p.ok) return;
    expect(p.steps.map((s) => s.command.join(" ")).join("\n"), "no editor install").to.not.contain("--install-extension");
  });

  it("says so when there is nothing to do", () => {
    const p = planAgentInstall("claude-code", [{ id: "claude-code" }], has("claude"));
    expect(p.ok).to.equal(false);
    if (p.ok) return;
    expect(p.message).to.contain("already installed");
  });
});

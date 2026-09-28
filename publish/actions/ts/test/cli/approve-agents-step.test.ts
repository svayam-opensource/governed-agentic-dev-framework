// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/** Adoption asks which agents the organization allows (#196, Q3). */
import { expect } from "chai";
import {
  selectableAgents, approvalPrompt, parseApprovalChoice, approvalSummary,
  noneOption, structureOnlyLines, agentsDiagnostic,
} from "../../src/cli/approve-agents-step.js";

describe("gov-work — approving agents during adoption (#196)", () => {
  it("offers only agents with something to run", () => {
    const ids = selectableAgents().map((a) => a.id);
    expect(ids, "a browser tool has nothing to launch").to.not.include("chatgpt-web");
    expect(ids).to.include("claude-code");
  });

  it("says why this is being asked now, and that it can change later", () => {
    const text = approvalPrompt().join("\n");
    expect(text, "the consequence of leaving one off").to.contain("prohibited by default");
    expect(text, "and that it binds everyone who joins").to.contain("everyone who joins");
    expect(text, "and that it is not permanent").to.contain("through a pull request");
    expect(text, "and how the default is chosen").to.contain("The first one becomes the");
  });

  it("takes numbers, and makes the first pick the default", () => {
    const r = parseApprovalChoice("1 2");
    expect(r.ok).to.equal(true);
    if (!r.ok) return;
    expect(r.agents).to.have.length(2);
    expect(r.agents[0]!.default, "the first, as the prompt promised").to.equal(true);
    expect(r.agents[1]!.default).to.equal(undefined);
  });

  it("takes ids too, for anyone who read the list rather than counting it", () => {
    const r = parseApprovalChoice("cursor");
    expect(r.ok && r.agents).to.deep.equal([{ id: "cursor", default: true }]);
  });

  it("ignores a repeat rather than approving the same agent twice", () => {
    const r = parseApprovalChoice("1 1");
    expect(r.ok && r.agents).to.have.length(1);
  });

  it("refuses an empty answer — this is the one question that must be answered", () => {
    // Everything downstream reads the list this produces: installs, the joiner's
    // flow, the work menu. An empty answer would restore the unowned state that
    // asking at all was meant to remove.
    const r = parseApprovalChoice("   ");
    expect(r.ok).to.equal(false);
    if (r.ok) return;
    expect(r.message).to.contain("Choose at least one");
    // AND IT NOW POINTS SOMEWHERE. The old message was "an organization with no approved agent
    // cannot run any", which is a wall: an org that genuinely runs none had to approve a tool it
    // would never use. The refusal stands; it names the option that says what was meant.
    expect(r.message, "the answer for an org that uses no agents").to.contain(String(noneOption()));
  });

  it("refuses a number that is not on the list, quoting what was typed", () => {
    const r = parseApprovalChoice("1 99");
    expect(r.ok).to.equal(false);
    if (r.ok) return;
    expect(r.message).to.contain("'99'");
  });

  it("says what was recorded, and that it is a rule now", () => {
    const r = parseApprovalChoice("1");
    expect(r.ok).to.equal(true);
    if (!r.ok) return;
    const text = approvalSummary(r.agents).join("\n");
    expect(text).to.contain("Approved for this organization");
    expect(text).to.contain("Default for people who join");
    expect(text, "and says where the decision is recorded").to.contain("org-config.yaml");
    expect(text).to.contain("gov agent approve");
  });
});

/**
 * STRUCTURE-ONLY AT THE APPROVAL STEP.
 *
 * Fixed behaviour must be complete on its own; agentic behaviour is additive. An organization may
 * want gov purely to put structure into its development process — projects, tasks, branches,
 * knowledge — and never run an AI agent. Until this option existed it could not say so.
 */
describe("gov-work — choosing NO agents (structure-only)", () => {
  it("offers `none` as its own numbered option, worded as a decision and not as a skip", () => {
    const text = approvalPrompt().join("\n");
    expect(text).to.contain(`${noneOption()}) none — this organization does not use AI agents`);
    expect(text, "and says what is still true, which is the whole fixed process")
      .to.contain("projects, tasks, branches, knowledge, review");
    expect(text, "never offered as skipping the question").to.not.contain("skip");
  });

  it("numbers `none` past the last agent, so no existing number moves", () => {
    expect(noneOption()).to.equal(selectableAgents().length + 1);
  });

  it("parses the number — and the word, for anyone who typed what they read", () => {
    expect(parseApprovalChoice(String(noneOption()))).to.deep.equal({ ok: true, agents: [] });
    expect(parseApprovalChoice("none")).to.deep.equal({ ok: true, agents: [] });
  });

  it("refuses `none` mixed with an agent rather than silently dropping half of it", () => {
    const r = parseApprovalChoice(`1 ${noneOption()}`);
    expect(r.ok).to.equal(false);
    if (r.ok) return;
    expect(r.message).to.contain("on its own");
  });

  it("reads the decision back, and names the command that reverses it", () => {
    const text = approvalSummary([]).join("\n");
    expect(text).to.contain("does not use AI agents");
    expect(text).to.contain("authorized_agents: none");
    expect(text, "turning agents on later is named, not implied").to.contain("gov agent approve <id>");
  });

  it("every screen that says agents are off also says where it is recorded and how to change it", () => {
    const text = structureOnlyLines().join("\n");
    expect(text).to.contain("authorized_agents: none");
    expect(text).to.contain("org-config.yaml");
    expect(text).to.contain("gov agent approve <id>");
    expect(text, "and that gov is still doing its job").to.contain("projects, tasks, branches");
  });
});

/** `gov doctor`'s row — the pure helper doctor.ts calls. */
describe("gov-work — the agents row in gov doctor", () => {
  it("reports structure-only as a STATE, not a warning", () => {
    const row = agentsDiagnostic('org_name: "Acme"\nauthorized_agents: none\n');
    expect(row).to.deep.equal({ name: "agents", status: "ok", detail: "none authorized (structure-only)" });
  });

  it("WARNS only when nobody has answered — that org is governed by a list it never chose", () => {
    const row = agentsDiagnostic('org_name: "Acme"\n');
    expect(row?.status).to.equal("warn");
    expect(row?.detail, "and both ways out are named").to.contain("gov agent approve");
    expect(row?.detail).to.contain("authorized_agents: none");
  });

  it("counts the list and names the default when there is one", () => {
    const row = agentsDiagnostic('authorized_agents:\n  default: "ibm-bob"\n  agent1: "claude-code"\n');
    expect(row).to.deep.equal({ name: "agents", status: "ok", detail: "2 authorized (default: IBM Bob)" });
  });

  it("no row at all when no org-config was examined — doctor's own rule", () => {
    expect(agentsDiagnostic(null)).to.equal(null);
    expect(agentsDiagnostic(undefined)).to.equal(null);
  });
});

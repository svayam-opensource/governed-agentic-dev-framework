// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/** Adoption asks which agents the organization allows (#196, Q3). The question is tested in agent-selection.test.ts. */
import { expect } from "chai";
import { approvalSummary, structureOnlyLines, agentsDiagnostic } from "../../src/cli/approve-agents-step.js";

describe("gov-work — approving agents during adoption (#196)", () => {
  it("says what was recorded, and that it is a rule now", () => {
    const text = approvalSummary([{ id: "claude-code", default: true }]).join("\n");
    expect(text).to.contain("Approved for this organization");
    expect(text).to.contain("Default for people who join");
    expect(text, "and says where the decision is recorded").to.contain("policies/governance.yaml");
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
  it("reads the decision back, and names the command that reverses it", () => {
    const text = approvalSummary([]).join("\n");
    expect(text).to.contain("does not use AI agents");
    expect(text).to.contain("authorized_agents: none");
    expect(text, "turning agents on later is named, not implied").to.contain("gov agent approve <id>");
  });

  it("every screen that says agents are off also says where it is recorded and how to change it", () => {
    const text = structureOnlyLines().join("\n");
    expect(text).to.contain("authorized_agents: none");
    expect(text).to.contain("policies/governance.yaml");
    expect(text).to.contain("gov agent approve <id>");
    expect(text, "and that gov is still doing its job").to.contain("projects, tasks, branches");
  });
});

/** `gov doctor`'s row — the pure helper doctor.ts calls. */
describe("gov-work — the agents row in gov doctor", () => {
  it("GOV-FRM-446 reports structure-only as a STATE, not a warning", () => {
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
    expect(agentsDiagnostic(undefined)).to.equal(null);
    // An examined workspace with no governance.yaml has chosen nothing: that is the unset row, not no row.
    expect(agentsDiagnostic(null)!.status).to.equal("warn");
  });
});

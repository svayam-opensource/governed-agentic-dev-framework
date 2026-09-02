// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/** Adoption asks which agents the organization allows (#196, Q3). */
import { expect } from "chai";
import { selectableAgents, approvalPrompt, parseApprovalChoice, approvalSummary } from "../../src/cli/approve-agents-step.js";

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
    expect(text).to.contain("llm-governance.md");
    expect(text).to.contain("gov agent approve");
  });
});

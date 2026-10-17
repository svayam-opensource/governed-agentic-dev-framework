// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/** Who decides which agent opens (#196, Q9; Policy Owner, 2026-10-12: last used on the project, else the org default). */
import { expect } from "chai";
import { chooseAgent, choiceExplanation } from "../../src/cli/agent-choice.js";

const APPROVED = [{ id: "claude-code", default: true }, { id: "cursor" }];
const name = (id: string) => id;

describe("gov-work — choosing an agent (#196)", () => {
  it("one installed approved agent needs no question", () => {
    const r = chooseAgent(APPROVED, null, ["cursor"]);
    expect(r).to.deep.equal({ id: "cursor", source: "only-one" });
  });

  it("resuming: the agent used last time on the project wins over the org default, inside the approved set", () => {
    const r = chooseAgent(APPROVED, "cursor", ["claude-code", "cursor"]);
    expect(r.id).to.equal("cursor");
    expect(r.source).to.equal("last-used");
  });

  it("last time's Cursor editor is the approved `cursor`", () => {
    expect(chooseAgent(APPROVED, "cursor-gui", ["claude-code", "cursor"])).to.deep.equal({ id: "cursor", source: "last-used" });
  });

  it("seeding from scratch (no last-used): the org default decides", () => {
    const r = chooseAgent(APPROVED, null, ["claude-code", "cursor"]);
    expect(r).to.deep.equal({ id: "claude-code", source: "org-default" });
  });

  it("asks only when neither layer answers", () => {
    // Two installed, none marked default, nothing used before — the one case worth a question.
    const r = chooseAgent([{ id: "claude-code" }, { id: "cursor" }], null, ["claude-code", "cursor"]);
    expect(r.id).to.equal(null);
    expect(r.source).to.equal("asked");
  });

  it("a last-used agent the org no longer approves falls back to the org default, checked AT LAUNCH", () => {
    // An org narrowing its policy yesterday takes effect today — not whenever someone opens a different agent.
    const r = chooseAgent([{ id: "cursor", default: true }], "claude-code", ["claude-code", "cursor"]);
    expect(r.id).to.equal("cursor");
    expect(r.source).to.equal("org-default");
    expect(r.ignoredLastUsed).to.deep.equal({ id: "claude-code", why: "your organization no longer approves it" });
  });

  it("a last-used agent no longer installed falls back to the org default, and says why", () => {
    const r = chooseAgent(APPROVED, "cursor", ["claude-code"]);
    expect(r.id).to.equal("claude-code");
    expect(r.source).to.equal("org-default");
    expect(r.ignoredLastUsed!.why).to.contain("not installed");
  });

  it("the fallback is the org DEFAULT, even when another approved agent is the only one installed besides", () => {
    const three = [{ id: "ibm-bob", default: true }, { id: "claude-code" }, { id: "cursor" }];
    const r = chooseAgent(three, "cursor", ["ibm-bob", "claude-code"]);
    expect(r).to.include({ id: "ibm-bob", source: "org-default" });
  });

  it("nothing installed → nothing to choose", () => {
    expect(chooseAgent(APPROVED, null, [])).to.deep.equal({ id: null, source: "none" });
  });

  it("an org that authorized NO agents chooses none — whatever is installed, whatever was used before", () => {
    // `[]` is the structure-only decision, not "gov has no list". The filter used to be waved
    // through on an empty list, so every installed agent counted as usable and a stated
    // preference was launched — the organization's own rule overridden by what was on the machine.
    expect(chooseAgent([], null, ["claude-code", "cursor"])).to.deep.equal({ id: null, source: "none" });
    const withLast = chooseAgent([], "cursor", ["claude-code", "cursor"]);
    expect(withLast.id).to.equal(null);
    expect(withLast.ignoredLastUsed?.why, "and the person is told why not").to.contain("no longer approves it");
    // NULL is still "no list to filter by", which is the undecided org and must not change.
    expect(chooseAgent(null, null, ["cursor"])).to.deep.equal({ id: "cursor", source: "only-one" });
  });

  it("says who decided, so nobody wonders why this one opened", () => {
    expect(choiceExplanation(chooseAgent(APPROVED, "cursor", ["claude-code", "cursor"]), name).join("\n"))
      .to.contain("the agent you used last time on this project");
    expect(choiceExplanation(chooseAgent(APPROVED, null, ["claude-code", "cursor"]), name).join("\n"))
      .to.contain("your organization's default");
    expect(choiceExplanation(chooseAgent(APPROVED, null, ["cursor"]), name).join("\n"))
      .to.contain("the only approved agent installed here");
    // And a last-used agent that could not be opened is never silent.
    expect(choiceExplanation(chooseAgent(APPROVED, "cursor", ["claude-code"]), name).join("\n"))
      .to.contain("was not opened");
  });
});

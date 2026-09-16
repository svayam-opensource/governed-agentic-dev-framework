// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/** Who decides which agent opens (#196, Q9). */
import { expect } from "chai";
import { chooseAgent, choiceExplanation } from "../../src/cli/agent-choice.js";

const APPROVED = [{ id: "claude-code", default: true }, { id: "cursor" }];
const name = (id: string) => id;

describe("gov-work — choosing an agent (#196)", () => {
  it("one installed approved agent needs no question", () => {
    const r = chooseAgent(APPROVED, null, ["cursor"]);
    expect(r).to.deep.equal({ id: "cursor", source: "only-one" });
  });

  it("a preference wins over the org default, inside the approved set", () => {
    const r = chooseAgent(APPROVED, "cursor", ["claude-code", "cursor"]);
    expect(r.id).to.equal("cursor");
    expect(r.source).to.equal("preference");
  });

  it("the org default decides when there is no preference", () => {
    const r = chooseAgent(APPROVED, null, ["claude-code", "cursor"]);
    expect(r).to.deep.equal({ id: "claude-code", source: "org-default" });
  });

  it("asks only when neither layer answers", () => {
    // Two installed, none marked default, no preference — the one case worth a question.
    const r = chooseAgent([{ id: "claude-code" }, { id: "cursor" }], null, ["claude-code", "cursor"]);
    expect(r.id).to.equal(null);
    expect(r.source).to.equal("asked");
  });

  it("a preference outside the approved set is refused AT LAUNCH, not at write time", () => {
    // If it were validated only when written, an org narrowing its policy would keep
    // launching the forbidden tool until someone happened to edit their preferences.
    const r = chooseAgent([{ id: "cursor", default: true }], "claude-code", ["claude-code", "cursor"]);
    expect(r.id).to.equal("cursor");
    expect(r.ignoredPreference).to.deep.equal({ id: "claude-code", why: "your organization no longer approves it" });
  });

  it("a preference for an approved-but-absent agent falls back, and says why", () => {
    const r = chooseAgent(APPROVED, "cursor", ["claude-code"]);
    expect(r.id).to.equal("claude-code");
    expect(r.ignoredPreference!.why).to.contain("not installed");
  });

  it("nothing installed → nothing to choose", () => {
    expect(chooseAgent(APPROVED, null, [])).to.deep.equal({ id: null, source: "none" });
  });

  it("says who decided, so nobody wonders why this one opened", () => {
    expect(choiceExplanation(chooseAgent(APPROVED, "cursor", ["claude-code", "cursor"]), name).join("\n"))
      .to.contain("your preference");
    expect(choiceExplanation(chooseAgent(APPROVED, null, ["claude-code", "cursor"]), name).join("\n"))
      .to.contain("your organization's default");
    expect(choiceExplanation(chooseAgent(APPROVED, null, ["cursor"]), name).join("\n"))
      .to.contain("the only approved agent installed here");
    // And an ignored preference is never silent.
    expect(choiceExplanation(chooseAgent(APPROVED, "cursor", ["claude-code"]), name).join("\n"))
      .to.contain("was not used");
  });
});

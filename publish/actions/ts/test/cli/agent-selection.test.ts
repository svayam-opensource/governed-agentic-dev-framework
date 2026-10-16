// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * Q11, as an adopter actually answers it — the one-agent-at-a-time selection (`agent-selection.ts`),
 * and in particular the answer that says "we do not use AI agents".
 *
 * THIS IS THE LIVE PROMPT. `approve-agents-step.ts` holds the same question in its older
 * space-separated form and is tested beside it; the interview drives THIS one, so the `none`
 * option has to exist here or an adopter can never choose it.
 */
import { expect } from "chai";
import {
  offeredAgents, parsePick, noneOption, optionsLabelWithNone,
  defaultAgentLines, confirmLines, namesSentence, askAgentSelection,
} from "../../src/cli/agent-selection.js";

/** Drive the interview from a script of answers, recording what was printed. */
function run(answers: readonly string[]): { promise: Promise<readonly { id: string; default?: boolean }[] | null>; out: string[]; asked: string[] } {
  const out: string[] = []; const asked: string[] = [];
  let i = 0;
  const promise = askAgentSelection({
    print: (l) => out.push(l),
    prompt: async (q) => { asked.push(q); return answers[i++] ?? ""; },
  });
  return { promise, out, asked };
}

describe("gov-work — Q11 offers 'none', and it is an answer (structure-only)", () => {
  it("numbers `none` one past the WHOLE catalog, so a chosen agent never renumbers it", () => {
    // The file's own lesson: a list that renumbers itself between prompts turns an answer the
    // reader has already composed into the wrong one.
    expect(noneOption()).to.equal(offeredAgents().length + 1);
    expect(optionsLabelWithNone(offeredAgents())).to.contain(`/${noneOption()}]`);
  });

  it("is offered on the DEFAULT question, worded as the other kind of organization", () => {
    const text = defaultAgentLines(offeredAgents()).join("\n");
    expect(text).to.contain(`${noneOption()}) none — this organization does not use AI agents`);
    expect(text).to.contain("projects, tasks, branches, knowledge, review");
    expect(text, "not offered as a way past the question").to.not.contain("skip");
  });

  it("parses the number and the word on that question", () => {
    expect(parsePick(String(noneOption()), offeredAgents(), false)).to.deep.equal({ kind: "none" });
    expect(parsePick("none", offeredAgents(), false)).to.deep.equal({ kind: "none" });
  });

  it("is NOT an answer to 'any others?' — blank already means no more", () => {
    // Accepting it there would let "none" arrive after an agent had been chosen, which is a
    // contradiction gov would have to resolve by guessing.
    expect(parsePick("none", offeredAgents(), true).kind).to.equal("error");
    expect(parsePick("", offeredAgents(), true)).to.deep.equal({ kind: "done" });
  });

  it("an EMPTY answer to the default question is still refused — and now points at `none`", () => {
    const r = parsePick("   ", offeredAgents(), false);
    expect(r.kind).to.equal("error");
    if (r.kind !== "error") return;
    expect(r.message).to.contain(String(noneOption()));
    expect(r.message, "the wall is gone").to.not.contain("cannot run any");
  });

  it("choosing it skips the additions question entirely and reads the decision back", async () => {
    const { promise, out, asked } = run([String(noneOption()), "y"]);
    const picked = await promise;
    expect(picked, "an empty LIST — an answer, not a refusal").to.deep.equal([]);
    expect(asked, "two questions: which, then confirm").to.have.length(2);
    const text = out.join("\n");
    expect(text, "never asked to add another").to.not.contain("add any other AI agent");
    expect(text).to.contain("You have selected — NO AI agents");
    expect(text).to.contain("authorized_agents: none");
    expect(text).to.contain("gov agent approve <id>");
  });

  it("the confirmation can still be declined, and choosing again can land on an agent", async () => {
    const { promise } = run([String(noneOption()), "n", "1", "", "y"]);
    const picked = await promise;
    expect(picked?.map((a) => a.id)).to.deep.equal([offeredAgents()[0]!.id]);
    expect(picked?.[0]?.default).to.equal(true);
  });

  it("choosing an agent behaves exactly as before — nothing about the old path moved", async () => {
    const { promise, out } = run(["1", "", "y"]);
    const picked = await promise;
    expect(picked).to.deep.equal([{ id: offeredAgents()[0]!.id, default: true }]);
    expect(out.join("\n")).to.contain("as authorized AI agents to be used in");
  });

  it("namesSentence and confirmLines survive the empty list rather than throwing on it", () => {
    // `confirmLines` reached `agents.find((a) => a.default)!` through a non-null assertion that
    // held only while the list could not be empty.
    expect(namesSentence([])).to.equal("none");
    expect(confirmLines([]).join("\n")).to.contain("NO AI agents");
  });
});

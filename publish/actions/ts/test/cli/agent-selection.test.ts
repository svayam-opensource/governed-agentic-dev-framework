// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * Q12, as an adopter actually answers it (`agent-selection.ts`): the default as a single-select, the others as a
 * multi-select (F158, ruling Q12 A), through the shared picker — and the answer that says "we do not use AI agents".
 */
import { expect } from "chai";
import { EventEmitter } from "node:events";
import {
  offeredAgents, noneOption, defaultAgentItems, defaultAgentLines, defaultAgentHelp,
  confirmLines, namesSentence, askAgentSelection, DEFAULT_AGENT_QUESTION, MORE_AGENTS_QUESTION,
} from "../../src/cli/agent-selection.js";
import { parseNumbered, type PickerTerminal } from "../../src/cli/picker.js";

/** Drive the NUMBERED form from a script of answers, recording what was printed. */
function run(answers: readonly string[]): { promise: Promise<readonly { id: string; default?: boolean }[] | null>; out: string[]; asked: string[] } {
  const out: string[] = []; const asked: string[] = [];
  let i = 0;
  const promise = askAgentSelection({
    print: (l) => out.push(l),
    prompt: async (q) => { asked.push(q); return answers[i++] ?? ""; },
  });
  return { promise, out, asked };
}

describe("gov-work — Q12 offers 'none', and it is an answer (structure-only)", () => {
  it("numbers `none` one past the WHOLE catalog, so a chosen agent never renumbers it", () => {
    expect(noneOption()).to.equal(offeredAgents().length + 1);
    expect(defaultAgentItems().at(-1)!.number).to.equal(noneOption());
  });

  it("is offered on the DEFAULT question, worded as the other kind of organization", () => {
    const none = defaultAgentItems().at(-1)!;
    expect(none.label).to.equal("none — this organization does not use AI agents");
    expect(none.note!.join("\n")).to.contain("projects, tasks, branches, knowledge, review");
    const text = [...defaultAgentLines(), ...defaultAgentHelp(), none.label].join("\n");
    expect(text, "not offered as a way past the question").to.not.contain("skip");
    expect(text).to.contain("default for your organization");
  });

  it("parses the number and the word on that question", () => {
    const spec = { items: defaultAgentItems() };
    const last = defaultAgentItems().length - 1;
    expect(parseNumbered(spec, String(noneOption()), false)).to.deep.equal({ ok: true, picks: [last] });
    expect(parseNumbered(spec, "none", false)).to.deep.equal({ ok: true, picks: [last] });
    expect(parseNumbered(spec, "ibm-bob", false)).to.deep.equal({ ok: true, picks: [offeredAgents().findIndex((a) => a.id === "ibm-bob")] });
  });

  it("an EMPTY answer to the default question is refused — and points at `none`", async () => {
    const { promise, out } = run(["", "1", "", "y"]);
    await promise;
    expect(out.join("\n")).to.contain(`Choose one — or ${noneOption()} if this organization does not use AI agents.`);
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

  it("one agent and no others: the single-agent org, its default marked", async () => {
    const { promise, out } = run(["1", "", "y"]);
    const picked = await promise;
    expect(picked).to.deep.equal([{ id: offeredAgents()[0]!.id, default: true }]);
    expect(out.join("\n")).to.contain("as authorized AI agents to be used in");
  });

  it("the others are ONE multi-select, `1,3` style, with the default left out and numbers kept", async () => {
    const bob = offeredAgents().find((a) => a.id === "ibm-bob")!;
    const { promise, out, asked } = run([String(bob.n), "1,9", "y"]);
    const picked = await promise;
    expect(picked).to.deep.equal([{ id: "ibm-bob", default: true }, { id: "claude-code" }, { id: "aider" }]);
    expect(out.join("\n")).to.contain(MORE_AGENTS_QUESTION);
    expect(asked[1], "the default is not offered twice").to.not.contain(`/${bob.n}/`);
    expect(asked[1], "and nobody is renumbered").to.contain("/9]");
    expect(out.join("\n")).to.contain("'IBM Bob' (default), 'Claude Code' and 'Aider'");
  });

  it("namesSentence and confirmLines survive the empty list rather than throwing on it", () => {
    expect(namesSentence([])).to.equal("none");
    expect(confirmLines([]).join("\n")).to.contain("NO AI agents");
  });

  it("asks the ruling's question word for word", () => {
    expect(DEFAULT_AGENT_QUESTION).to.equal("Which AI agent would you like to use as the default in your organization?");
    expect(MORE_AGENTS_QUESTION).to.equal("Would you like to add any other AI agent to the allowed list?");
  });
});

describe("gov-work — Q12 with the arrow picker (F158)", () => {
  class In extends EventEmitter {
    isTTY = true; isRaw = false;
    setRawMode(m: boolean): this { this.isRaw = m; return this; }
    resume(): this { return this; }
    pause(): this { return this; }
  }
  it("End, Up, Up picks IBM Bob; Space on Claude Code and Aider adds them; the default stays marked", async () => {
    const input = new In();
    const t: PickerTerminal = { input, output: { isTTY: true, columns: 120, write: () => true } };
    const asked: string[] = [];
    const p = askAgentSelection({ prompt: async (q) => { asked.push(q); return "y"; }, print: () => {}, terminal: t, env: {} });
    const tick = (): Promise<void> => new Promise((r) => setImmediate(r));
    await tick();
    input.emit("data", Buffer.from("\u001b[F\u001b[A\u001b[A\r")); // End (none), Up (Aider), Up (IBM Bob), Enter
    await tick();
    input.emit("data", Buffer.from(" \u001b[F \r"));                // Space (Claude Code), End (Aider), Space, Enter
    const picked = await p;
    expect(picked).to.deep.equal([{ id: "ibm-bob", default: true }, { id: "claude-code" }, { id: "aider" }]);
    expect(asked, "only the Y/n was typed").to.deep.equal(["  Choose (Y/n) : "]);
    expect(input.isRaw).to.equal(false);
  });
});

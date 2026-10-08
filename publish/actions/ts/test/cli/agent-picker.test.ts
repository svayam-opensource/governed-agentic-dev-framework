// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * EVERY APPROVED AGENT IS A CHOICE (Policy Owner, 2026-10-08).
 *
 * svm-geneva approved three agents; only IBM Bob was installed in the container, and `gov work` said "Using IBM Bob
 * — the only approved agent installed here" and launched it with no choice. Approved-but-not-installed is not
 * "not an option": it is an option that costs an install, and the person decides whether to pay it.
 */
import { expect } from "chai";
import { pickerRows, pickerDefault, pickerLines, pickerPrompt, resolvePickerAnswer } from "../../src/cli/agent-picker.js";
import { AGENT_CATALOG, agentStatuses } from "../../src/cli/agent-catalog.js";

const GENEVA = [{ id: "ibm-bob", default: true }, { id: "openai-codex" }, { id: "claude-code" }];
const onlyBob = agentStatuses(AGENT_CATALOG, (c) => c === "bob", {});

describe("the agent picker — every approved agent, installed or not", () => {
  it("renders the Geneva case exactly: three rows, display names, what each costs", () => {
    const rows = pickerRows(GENEVA, onlyBob, null);
    const lines = pickerLines(rows, "PRJ-31 (approved by Geneva ERS)");
    expect(lines).to.deep.equal([
      "  Agent for PRJ-31 (approved by Geneva ERS):",
      "    1) IBM Bob        installed · organization default",
      "    2) OpenAI Codex   not installed — choose it to install now",
      "    3) Claude Code    not installed — choose it to install now",
    ]);
    expect(pickerPrompt(rows, pickerDefault(rows, null, "ibm-bob"))).to.equal("  Choose [1/2/3] (Enter = 1, IBM Bob) : ");
  });

  it("Enter is the person's preference when set, else the org default", () => {
    const rows = pickerRows(GENEVA, onlyBob, "claude-code");
    expect(pickerDefault(rows, "claude-code", "ibm-bob")).to.equal(2);
    expect(pickerDefault(rows, null, "ibm-bob")).to.equal(0);
    expect(pickerLines(rows, "x")[3]).to.contain("your preference");
  });

  it("a preference the org does not approve is not the default — the org default is", () => {
    const rows = pickerRows(GENEVA, onlyBob, "cursor");
    expect(pickerDefault(rows, "cursor", "ibm-bob")).to.equal(0);
  });

  it("no default at all: Enter chooses nothing, and the prompt does not pretend otherwise", () => {
    const rows = pickerRows([{ id: "openai-codex" }, { id: "claude-code" }], onlyBob, null);
    const def = pickerDefault(rows, null, null);
    expect(def).to.equal(null);
    expect(pickerPrompt(rows, def)).to.equal("  Choose [1/2] : ");
    expect(resolvePickerAnswer("", rows, def)).to.equal(null);
  });

  it("an excluded agent (one that just failed on its account) is left out", () => {
    const rows = pickerRows(GENEVA, onlyBob, null, ["ibm-bob"]);
    expect(rows.map((r) => r.id)).to.deep.equal(["openai-codex", "claude-code"]);
    expect(pickerDefault(rows, null, "ibm-bob"), "the excluded default is no longer Enter").to.equal(null);
  });

  it("reads a number, Enter, or the agent's id; anything else is not an answer", () => {
    const rows = pickerRows(GENEVA, onlyBob, null);
    expect(resolvePickerAnswer("", rows, 0)).to.equal(0);
    expect(resolvePickerAnswer("3", rows, 0)).to.equal(2);
    expect(resolvePickerAnswer("openai-codex", rows, 0)).to.equal(1);
    expect(resolvePickerAnswer("4", rows, 0)).to.equal(null);
    expect(resolvePickerAnswer("zz", rows, 0)).to.equal(null);
  });

  it("an approved agent gov cannot start is still listed, and says so", () => {
    const rows = pickerRows([{ id: "chatgpt-web" }, { id: "ibm-bob", default: true }], onlyBob, null);
    expect(rows[0]!.state).to.equal("unlaunchable");
    expect(pickerLines(rows, "x")[1]).to.contain("gov cannot start it from here");
  });
});

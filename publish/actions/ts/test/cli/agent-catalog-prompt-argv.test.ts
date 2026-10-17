// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * No agent dies on a usage error (#207).
 *
 * A bare positional prompt for every agent is what killed the bob launch:
 * "too many arguments. Expected 0 arguments but got 1". The rule since: every
 * `cli` entry in the catalog either records the argv its vendor's `--help`
 * shows it accepts (`promptArgv`, with the prompt in it), or takes the paste
 * path — launched bare, the prompt handed to the person. There is no third shape.
 */
import { expect } from "chai";
import { AGENT_CATALOG } from "../../src/cli/agent-catalog.js";
import { agentLaunchSpec } from "../../src/cli/work-flow.js";

const cliAgents = AGENT_CATALOG.filter((a) => a.launch === "cli" && a.cmd);

describe("agent catalog — every cli entry has promptArgv or the paste path (#207)", () => {
  it("there are cli agents to check — an empty sweep proves nothing", () => {
    expect(cliAgents.length).to.be.greaterThan(0);
  });

  for (const a of cliAgents) {
    it(`${a.id}: ${a.promptArgv ? "recorded argv carries the prompt" : "launches bare and hands the prompt over"}`, () => {
      const spec = agentLaunchSpec(a.id, "/p", "GO-PROMPT");
      expect(spec, `${a.id} must launch`).to.not.equal(null);
      if (a.promptArgv) {
        expect(a.promptArgv.some((x) => x.includes("{prompt}")), "the recorded argv must place the prompt").to.equal(true);
        expect(spec!.args).to.include("GO-PROMPT");
        expect(spec!.promptToPaste, "argv delivery does not also paste").to.equal(undefined);
      } else {
        expect(spec!.args, "unverified argv: nothing is passed").to.deep.equal([]);
        expect(spec!.promptToPaste, "so the person is given the prompt").to.equal("GO-PROMPT");
      }
    });
  }
});

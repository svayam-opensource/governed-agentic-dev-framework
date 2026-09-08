// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * "How would you like to sign in?" (#213) — the question `gh` asks, and the reason it works:
 * both routes are NAMED. gov's first attempt printed a paragraph about the browser and then
 * prompted for a key with "or press Enter to skip", which makes one route the question and
 * the other an escape hatch a reader has to infer is for them.
 */
import { expect } from "chai";
import {
  signInOptions, signInPrompt, parseSignInChoice, afterSkip, type SignInFacts,
} from "../../src/cli/sign-in-choice.js";

const bob: SignInFacts = { tool: "IBM Bob", signsInItself: true, credentialEnv: "BOB_API_KEY" };
const claude: SignInFacts = { tool: "Claude Code", loginCommand: ["claude", "setup-token"], credentialEnv: "ANTHROPIC_API_KEY" };
const copilot: SignInFacts = { tool: "GitHub Copilot" };            // neither route recorded yet

describe("gov-work — how would you like to sign in (#213)", () => {
  it("an agent that opens its own browser is ALSO offered the key", () => {
    // The half #208 removed. Bob signs itself in — true of the agent, and silent about the
    // machine, which is how a container walk ran out of options at a loopback callback.
    expect(signInOptions(bob).map((o) => o.method)).to.deep.equal(["browser-at-start", "api-key", "skip"]);
  });

  it("so is an agent with its own login command — the vendor's route first, the key still named", () => {
    expect(signInOptions(claude).map((o) => o.method)).to.deep.equal(["login-command", "api-key", "skip"]);
  });

  it("an agent gov knows no key variable for offers what it can, and no more", () => {
    // Not a menu of one dressed up as a choice: skip is all that is available, and the caller
    // does not ask when there is nothing to ask about.
    expect(signInOptions(copilot).map((o) => o.method)).to.deep.equal(["skip"]);
  });

  it("skip is ALWAYS present — authenticating is not a toll on installing", () => {
    for (const f of [bob, claude, copilot]) {
      expect(signInOptions(f).at(-1)!.method, f.tool).to.equal("skip");
    }
  });

  it("the question names the machine's unknown rather than guessing at it", () => {
    const lines = signInPrompt(bob, signInOptions(bob)).join("\n");
    expect(lines).to.contain("How would you like to sign IBM Bob in?");
    expect(lines, "gov does not claim to know").to.contain("cannot tell whether this machine has one");
    expect(lines, "both routes are numbered and readable").to.match(/1\. Let IBM Bob sign you in/);
    expect(lines).to.match(/2\. Paste an API key now/);
  });

  it("no browser question where there is no browser route to speak of", () => {
    // Saying "gov cannot tell whether this machine has a browser" to someone being offered
    // only a key is noise about a decision they are not making.
    const onlyKey: SignInFacts = { tool: "Aider", credentialEnv: "OPENAI_API_KEY" };
    expect(signInPrompt(onlyKey, signInOptions(onlyKey)).join("\n")).to.not.contain("cannot tell whether");
  });

  it("a choice outside the list names nothing, so the caller asks again", () => {
    const o = signInOptions(bob);
    expect(parseSignInChoice("2", o)).to.equal("api-key");
    expect(parseSignInChoice("3", o)).to.equal("skip");
    expect(parseSignInChoice("0", o)).to.equal(null);
    expect(parseSignInChoice("4", o)).to.equal(null);
    expect(parseSignInChoice("", o)).to.equal(null);
    expect(parseSignInChoice("yes", o)).to.equal(null);
  });

  it("what a skip MEANS depends on what was skipped", () => {
    // Reporting them alike is #208 in reverse: an agent that can still authenticate itself is
    // usable after a skip; one that had only a key is not.
    expect(afterSkip(bob, "browser-at-start").join("\n")).to.contain("will ask you to sign in when it starts");
    expect(afterSkip(claude, "login-command").join("\n")).to.contain("claude setup-token");
    expect(afterSkip({ tool: "Aider", credentialEnv: "OPENAI_API_KEY" }, "none").join("\n"))
      .to.contain("cannot run until it has a key");
  });
});

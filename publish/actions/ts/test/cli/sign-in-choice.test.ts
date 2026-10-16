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
  apiKeyIntro, signInOptions, signInPrompt, parseSignInChoice, afterSkip, type SignInFacts,
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

/**
 * THE DESKTOP GOV ALREADY KNEW ABOUT (#221 applied to #213).
 *
 * Three walks on 2026-09-13 ended identically: a container with no browser, an adopter choosing
 * option 1 because it is option 1, and a login flow waiting for a browser that cannot open.
 * OpenAI Codex started a local login server; Claude Code sat at `/login` asking for a code from
 * a page nobody could reach. gov had worked out there was no desktop — #221 landed that probe —
 * and this screen was still printing "gov cannot tell whether this machine has one".
 *
 * #221's ruling is the constraint and it has not changed: a desktop hint may REORDER and
 * ANNOTATE, never withhold. Every test here asserts one of those two, or the invariant.
 */
describe("gov-work — sign-in order follows what the machine can do (#221 → #213)", () => {
  const container = { verdict: "no", because: "no DISPLAY or WAYLAND_DISPLAY" } as const;
  const overSsh = { verdict: "remote", because: "DISPLAY=localhost:10.0 over SSH" } as const;
  const desktop = { verdict: "yes", because: "DISPLAY=:0" } as const;
  const methods = (f: SignInFacts): readonly string[] => signInOptions(f).map((o) => o.method);

  it("on a machine with no browser, the key route is offered FIRST", () => {
    expect(methods({ ...claude, desktop: container })[0]).to.equal("api-key");
  });

  it("on a real desktop the browser route stays first — the hint is not a veto either way", () => {
    expect(methods({ ...claude, desktop: desktop })[0]).to.equal("login-command");
  });

  it("a remote display is treated like no local browser, because that is what it is", () => {
    // The case that shaped #221: GUI-capable, display elsewhere. A browser opens on the machine
    // holding the display, which is not the machine the adopter is typing on.
    expect(methods({ ...claude, desktop: overSsh })[0]).to.equal("api-key");
  });

  it("NEVER WITHHOLDS — every route survives every verdict", () => {
    // The invariant, and the one that matters most: a wrong guess about a desktop may cost
    // someone a reordered menu and must never cost them the only route that works.
    const withNone = methods(claude);
    for (const d of [container, overSsh, desktop]) {
      const got = methods({ ...claude, desktop: d });
      expect([...got].sort(), `verdict ${d.verdict} dropped a route`).to.deep.equal([...withNone].sort());
    }
  });

  it("skip stays last wherever it is reordered", () => {
    expect(methods({ ...claude, desktop: container }).at(-1)).to.equal("skip");
    expect(methods({ ...bob, desktop: container }).at(-1)).to.equal("skip");
  });

  it("says WHAT it observed, so a reader who knows better can disagree", () => {
    const text = signInPrompt({ ...claude, desktop: container }, signInOptions({ ...claude, desktop: container })).join("\n");
    expect(text).to.contain("no desktop here");
    expect(text, "the evidence, not just the conclusion").to.contain("no DISPLAY or WAYLAND_DISPLAY");
    expect(text, "and it must not still disclaim knowledge it has").to.not.contain("gov cannot tell");
  });

  it("with no hint at all it says exactly what it always said", () => {
    // Absent means "take no view". Every caller before #221 was in this state and must not
    // start seeing invented conclusions.
    const text = signInPrompt(claude, signInOptions(claude)).join("\n");
    expect(text).to.contain("gov cannot tell whether this machine has one");
  });

  it("the browser caveat talks about a BROWSER, not an editor", () => {
    // desktopCaveat ends "an editor may have nowhere to open" — right for the editor route,
    // wrong on a sign-in screen. Reusing it printed a sentence about editors to someone
    // choosing how to log in.
    const text = signInPrompt({ ...claude, desktop: container }, signInOptions({ ...claude, desktop: container })).join("\n");
    expect(text).to.contain("browser");
    expect(text).to.not.contain("editor");
  });
});

// PRJ-121, 2026-09-22 — after choosing "1. Paste an API key", a walk got the old disclaimer ("gov cannot tell
// whether this machine has one") straight after the menu had said "gov sees no desktop here", and was offered the
// same choice again. apiKeyIntro is what prints between that choice and the paste prompt.
describe("apiKeyIntro — after the key was chosen, no second question", () => {
  it("says nothing for an agent that signs itself in — the menu already explained", () => {
    expect(apiKeyIntro("IBM Bob", true, "BOB_API_KEY")).to.deep.equal([]);
  });
  it("never repeats the disclaimer or re-offers the choice, for any agent", () => {
    for (const signs of [true, false]) {
      const text = apiKeyIntro("X", signs, "X_KEY").join("\n");
      expect(text).to.not.contain("cannot tell whether");
      expect(text).to.not.match(/press Enter, and sign in/);
    }
  });
  it("for a key-only agent, says where the key will go — the menu does not", () => {
    expect(apiKeyIntro("Aider", false, "OPENAI_API_KEY").join("\n")).to.contain("the key goes in your environment as OPENAI_API_KEY");
  });
});

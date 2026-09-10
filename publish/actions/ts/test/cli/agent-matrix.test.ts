// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * EVERY SELECTABLE AGENT, NOT JUST THE ONE THAT WAS WALKED.
 *
 * The e2e journey exercises `ibm-bob` end to end and nothing else. That was defensible while
 * approval was a free-text list an adopter had to compose; it stopped being defensible when Q10
 * turned it into a menu of ten. A selection UI that offers ten agents is ten paths a real
 * adopter can take, and one of them was tested.
 *
 * This is the part that needs no vendor and no credential: what gov CLAIMS about each agent,
 * and what gov DOES with that claim. Whether a vendor's CLI accepts the flags we pass is not
 * knowable from here and is not asserted — see EXPECTED below, which forces that unknown to be
 * stated per agent rather than left silent.
 *
 * The table is deliberately exhaustive and hand-written. A new catalog entry fails here until
 * somebody fills in a row, which is the only mechanism that reliably converts "we added an
 * agent" into "we decided what we know about it".
 */
import { expect } from "chai";
import { AGENT_CATALOG } from "../../src/cli/agent-catalog.js";
import { agentLaunchSpec } from "../../src/cli/work-flow.js";
import { offeredAgents, parsePick } from "../../src/cli/agent-selection.js";

/**
 * What we know about each agent, stated once.
 *
 * `install`   — can gov install it, or only point at a page? `url` means a human does it.
 * `launch`    — can gov start it? `no` means it is an editor extension with no binary.
 * `prompt`    — how the session-start message reaches it. `argv` is VERIFIED against the
 *               vendor's CLI; `paste` means gov prints it for the human, which always works
 *               and is the honest answer while the flags are unverified (#207).
 * `credEnv`   — the variable a headless key would use, or null.
 */
const EXPECTED: Readonly<Record<string, {
  install: "npm" | "script" | "brew" | "pip" | "url";
  launch: "cli" | "ide" | "no";
  prompt: "argv" | "paste";
  credEnv: string | null;
}>> = {
  "claude-code":        { install: "npm",    launch: "cli", prompt: "argv",  credEnv: "ANTHROPIC_API_KEY" },
  "cursor":             { install: "script", launch: "cli", prompt: "argv",  credEnv: null },
  "openai-codex":       { install: "npm",    launch: "cli", prompt: "paste", credEnv: "OPENAI_API_KEY" },
  "gemini-code-assist": { install: "npm",    launch: "cli", prompt: "paste", credEnv: "GEMINI_API_KEY" },
  "github-copilot":     { install: "npm",    launch: "cli", prompt: "paste", credEnv: null },
  "windsurf":           { install: "url",    launch: "ide", prompt: "paste", credEnv: null },
  // Both shipped CLIs after these entries were written; the catalog said otherwise until
  // 2026-09-10. `continue`'s binary is `cn`, not `continue` — see the catalog comment.
  "cline":              { install: "npm",    launch: "cli", prompt: "paste", credEnv: null },
  "continue":           { install: "npm",    launch: "cli", prompt: "paste", credEnv: null },
  "ibm-bob":            { install: "script", launch: "cli", prompt: "paste", credEnv: "BOB_API_KEY" },
  "aider":              { install: "pip",    launch: "cli", prompt: "paste", credEnv: "OPENAI_API_KEY" },
};

const selectable = AGENT_CATALOG.filter((a) => a.launch !== "none");

/**
 * The list adoption actually offers (Policy Owner, 2026-09-10, revised same day).
 *
 * Eight. The two that remain off it are off for a CAPABILITY reason, not a support one: gov can
 * install nothing for `windsurf` (desktop download; npm `windsurf` is not the vendor's) or for
 * `aider` (PyPI, and `install` has no `pip` field). Every agent on the menu can be installed
 * and launched by gov — which is the criterion, and what the test below enforces.
 */
const GA = ["claude-code", "cursor", "openai-codex", "gemini-code-assist", "github-copilot",
            "cline", "continue", "ibm-bob", "aider"];
const DEFERRED = ["windsurf"];

describe("every selectable agent — the catalog's claims", () => {
  it("the table covers every launchable entry, in catalog order", () => {
    expect(selectable.map((a) => a.id)).to.deep.equal(Object.keys(EXPECTED));
  });

  it("the MENU offers only what gov can install AND launch", () => {
    // The order IS the numbering an adopter answers with, so a reordered catalog silently
    // changes what `3` means. Pinning it makes that a test failure rather than a support
    // question from someone whose default is suddenly a different vendor.
    expect(offeredAgents().map((a) => a.id)).to.deep.equal(GA);
    expect(offeredAgents().map((a) => a.n), "numbered 1..n with no gaps — an adopter never sees a number they cannot choose")
      .to.deep.equal(GA.map((_, i) => i + 1));
    expect(selectable.filter((a) => a.deferred).map((a) => a.id)).to.deep.equal(DEFERRED);
  });

  it("every offered agent can be installed AND launched — no dead ends on the menu", () => {
    // THE CRITERION for being on the menu, stated as a test: gov can install it and gov can
    // launch it. windsurf and aider fail the first half, which is the whole reason they are off.
    for (const id of GA) {
      const a = selectable.find((x) => x.id === id)!;
      const installable = Boolean(a.install?.npm || a.install?.script || a.install?.brew || a.install?.pip)
        || (a.variants ?? []).some((v) => v.kind === "extension" || v.install?.npm || v.install?.script || v.install?.pip);
      expect(installable, `${id} is offered but gov can install nothing for it`).to.equal(true);
      expect(a.cmd, `${id} is offered but gov cannot launch it`).to.be.a("string");
    }
  });

  it("DEFERRAL AFFECTS THE MENU ONLY — an org already using one keeps working", () => {
    // Upgrading gov must never take an agent away from an organization that approved it. So a
    // deferred entry stays resolvable and stays launchable; it is simply not offered again.
    for (const id of DEFERRED) {
      const a = selectable.find((x) => x.id === id)!;
      if (!a.cmd) continue;                              // windsurf-shaped: nothing to launch anyway
      expect(agentLaunchSpec(id, "/proj", "GO", {}), `${id} must still launch when already approved`)
        .to.not.equal(null);
    }
  });

  for (const [id, want] of Object.entries(EXPECTED)) {
    describe(id, () => {
      const a = () => selectable.find((x) => x.id === id)!;

      it("says where a human can get it, whatever gov can do", () => {
        // The one universal promise: gov may not be able to install it, but it must never
        // leave someone with a name and no way to act on it.
        expect(a().install?.url, "every agent needs a url a person can open").to.be.a("string");
      });

      it(`gov ${want.install === "url" ? "can only point at a page" : `installs it by ${want.install}`}`, () => {
        const i = a().install;
        const how = i?.npm ? "npm" : i?.script ? "script" : i?.brew ? "brew" : i?.pip ? "pip" : "url";
        expect(how).to.equal(want.install);
      });

      it(want.launch === "no" ? "gov cannot launch it, and does not pretend to" : `gov launches it (${want.launch})`, () => {
        const spec = agentLaunchSpec(id, "/proj", "GO", {});
        if (want.launch === "no") {
          // #199's rule: an agent gov cannot start is said out loud, never substituted with a
          // shell. `null` is what makes the caller print that instead of opening a bare prompt.
          expect(a().cmd, "an unlaunchable agent has no command to pretend with").to.equal(undefined);
          expect(spec, "and the launch spec refuses rather than guessing").to.equal(null);
          return;
        }
        expect(spec, "a launchable agent must produce a spec").to.not.equal(null);
        expect(spec!.cmd).to.equal(a().cmd);
        expect(spec!.detached, "an editor is detached; a terminal agent inherits stdio")
          .to.equal(want.launch === "ide");
      });

      if (want.launch !== "no") {
        it(`delivers the session-start prompt by ${want.prompt}`, () => {
          const spec = agentLaunchSpec(id, "/proj", "GO", {})!;
          if (want.prompt === "argv") {
            // VERIFIED against the vendor's CLI. Only two agents are here, and that is the
            // honest count — #207 is the work of raising it.
            expect(a().promptArgv, "argv delivery needs the flags recorded").to.be.an("array");
            expect(spec.args, "the prompt must actually appear in the argv").to.include("GO");
            expect(spec.promptToPaste).to.equal(undefined);
          } else {
            // UNVERIFIED, and therefore pasted. This is not a defect — it is the correct
            // behaviour while nobody has confirmed the vendor's flags on a real machine. What
            // WOULD be a defect is guessing an argv, which is what #207 refuses to do.
            expect(a().promptArgv, "paste delivery means no argv is claimed").to.equal(undefined);
            expect(spec.promptToPaste, "so gov must hand the prompt to the human").to.equal("GO");
          }
        });
      }

      it(want.credEnv ? `carries a key in ${want.credEnv}` : "needs no key from gov", () => {
        expect(a().credentialEnv ?? null).to.equal(want.credEnv);
      });

      it(GA.includes(id) ? "can be chosen by number and by name" : "is not on the menu, so cannot be chosen", () => {
        const offered = offeredAgents();
        const row = offered.find((o) => o.id === id);
        if (!GA.includes(id)) {
          // A DEFERRED AGENT MUST NOT BE PICKABLE, by number or by name. Leaving it parseable
          // while hiding its row is how a menu of six ends up approving a seventh.
          expect(row, `${id} is deferred but still on the menu`).to.equal(undefined);
          expect(parsePick(id, offered, false).kind, "nor answerable by typing its id").to.equal("error");
          return;
        }
        expect(parsePick(String(row!.n), offered, false)).to.deep.equal({ kind: "pick", id });
        expect(parsePick(id.toUpperCase(), offered, false)).to.deep.equal({ kind: "pick", id });
      });
    });
  }
});

describe("the gaps this matrix exists to keep visible", () => {
  it("only two agents have a verified argv — the rest paste, and that is recorded per agent", () => {
    // Across the WHOLE catalog, offered or not.
    // A COUNT, ASSERTED. Raising it is #207's job; this fails when someone adds a promptArgv
    // without also verifying it here, and when someone removes one.
    const withArgv = selectable.filter((a) => a.promptArgv).map((a) => a.id);
    expect(withArgv).to.deep.equal(["claude-code", "cursor"]);
  });

  it("NOTHING launchable is left without a command — the gap cline and continue used to be", () => {
    // This assertion used to read "two agents are approvable but unlaunchable" and named them.
    // Both had shipped CLIs; the catalog had not noticed. The gap is closed, so the assertion
    // flips to the invariant — which is what stops the next stale entry recreating it.
    expect(selectable.filter((a) => !a.cmd).map((a) => a.id)).to.deep.equal([]);
  });

  it("two agents still cannot be installed by gov, for two different reasons", () => {
    // Both are OFF the menu because of this. Kept asserted so the reasons stay attached to the
    // fact: one is a desktop download, the other is a package manager gov does not speak.
    const noEntryInstall = selectable
      .filter((a) => !(a.install?.npm || a.install?.script || a.install?.brew || a.install?.pip))
      .map((a) => a.id);
    expect(noEntryInstall, "aider left this list when install.pip arrived (#221)").to.deep.equal(["windsurf"]);
    expect(GA, "and the one that remains is not offered").to.not.include("windsurf");
  });

  it("aider installs from PyPI, and NOT from the npm name anyone would guess", () => {
    // This assertion used to record the gap — "install has no pip" — and #221 closed it. What
    // is worth keeping is the trap: npm `aider` exists (v1.0.1, maintainer 36634584@qq.com) and
    // is a squat on exactly the name a well-meaning change would reach for.
    const aider = selectable.find((a) => a.id === "aider")!;
    expect(aider.install?.pip, "the project's own distribution").to.equal("aider-chat");
    expect(aider.install?.npm, "never the npm name — it is not theirs").to.equal(undefined);
    expect(GA, "and it is offered again now that gov can install it").to.include("aider");
  });
});

// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * #209 ON APT DISTROS — what gov SAYS when it cannot put an agent on the PATH.
 *
 * The defect was not the linking. gov is right to refuse to write a shortcut into a directory
 * that is not on PATH, and right not to edit a shell profile (#211). The defect was that all
 * three ways `linkAgentIntoPath` could decline came back as the same `null`, the caller printed
 * nothing for any of them, and the line immediately above was `✓ Bob Shell 2.0.2 installed and
 * runnable`. On debian:stable-slim and ubuntu:24.04 — where `~/.local/bin` is not on PATH — an
 * adopter read that, typed `bob`, and got `command not found`.
 *
 * Resolved with option (b) of the two on the table (Policy Owner, 2026-09-11): keep the
 * behaviour, say what is true. So these tests are about WORDS, and that is the point — the
 * words were the missing product.
 */
import { expect } from "chai";
import { linkOutcomeLines, type LinkOutcome } from "../../src/cli/main.js";
import { reporter } from "../../src/cli/format.js";

const NODE_BIN = "/home/tester/.local/share/gov/node/bin";
const LOCAL_BIN = "/home/tester/.local/bin";
const r = reporter(false);                       // no ANSI: assert words, never colour
const lines = (o: LinkOutcome): readonly string[] => linkOutcomeLines(o, "bob", r);
const text = (o: LinkOutcome): string => lines(o).join("\n");

describe("#209 — gov says when an installed agent will not be on the PATH", () => {
  it("linked: says so, and says where", () => {
    const t = text({ kind: "linked", dir: LOCAL_BIN });
    expect(t).to.contain(LOCAL_BIN);
    expect(t, "the claim a reader can check").to.contain("works after gov exits");
  });

  it("not-ours: says NOTHING, because nothing happened and nothing is owed", () => {
    // A vendor that installed to a directory already on PATH needs no help and no warning.
    // A message here would be noise, and noise is what made the real warning easy to miss.
    expect(lines({ kind: "not-ours" })).to.have.length(0);
  });

  it("nowhere-to-link: the debian case — warns, and does not claim to have linked", () => {
    const t = text({ kind: "nowhere-to-link", dir: LOCAL_BIN, nodeBin: NODE_BIN });
    expect(t, "the consequence, stated first").to.contain("will not be on your PATH after gov exits");
    expect(t, "and WHY, so it is not mysterious").to.contain("not on your PATH");
    expect(t, "names the directory it declined to write to").to.contain(LOCAL_BIN);
    expect(t, "and where the binary actually is").to.contain(NODE_BIN);
    expect(t, "never claims a link it did not make").to.not.contain("works after gov exits");
  });

  it("nowhere-to-link: gives a remedy that can actually work", () => {
    const t = text({ kind: "nowhere-to-link", dir: LOCAL_BIN, nodeBin: NODE_BIN });
    expect(t, "the fix the adopter controls").to.contain(`add ${LOCAL_BIN} to your PATH`);
    expect(t, "and the escape hatch, in full").to.contain(`${NODE_BIN}/bob`);
  });

  it("wrapper-failed: does NOT tell them to add a directory already on their PATH", () => {
    // THE BUG A SHARED REMEDY BLOCK HAD. `wrapper-failed` only happens AFTER the PATH check
    // passed, so "add it to your PATH" is advice that cannot work — and it was being printed.
    const t = text({ kind: "wrapper-failed", dir: LOCAL_BIN, nodeBin: NODE_BIN });
    expect(t).to.not.contain("to your PATH and run this install");
    expect(t, "it is gov's fault and says so").to.contain("gov's to fix, not yours");
    expect(t, "with the one thing that does work").to.contain(`${NODE_BIN}/bob`);
  });

  it("every warning line fits an 80-column terminal", () => {
    // A warning that wraps mid-word in the terminal it is read in is a warning that gets
    // skipped — the same lesson as the paste indicator that wrapped and repeated itself.
    for (const o of [
      { kind: "nowhere-to-link", dir: LOCAL_BIN, nodeBin: NODE_BIN },
      { kind: "wrapper-failed", dir: LOCAL_BIN, nodeBin: NODE_BIN },
      { kind: "linked", dir: LOCAL_BIN },
    ] as const satisfies readonly LinkOutcome[]) {
      for (const l of lines(o)) {
        expect(l.length, `${o.kind}: "${l}"`).to.be.at.most(80);
      }
    }
  });

  it("the warning uses the warn mark, which is neither ok nor fail", () => {
    // The install SUCCEEDED, so a ✗ is a lie; the command will not be found, so a ✓ is too.
    // With only two marks the honest line had nowhere to go and the code said nothing at all.
    const first = lines({ kind: "nowhere-to-link", dir: LOCAL_BIN, nodeBin: NODE_BIN })[0]!;
    expect(first).to.contain("!");
    expect(first).to.not.contain("✓");
    expect(first).to.not.contain("✗");
  });
});

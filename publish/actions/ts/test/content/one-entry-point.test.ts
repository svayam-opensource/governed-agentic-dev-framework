// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * ONE ENTRY POINT FOR PEOPLE (PRJ-121 intent 01, spec §3.10, I01.5 — task L09).
 *
 * A person starts in one way: install.sh, then the first-run flow (adopt / join / not sure); on Windows, the
 * installer (intent 04 owns both doors). `gov setup` is the machine verb the first-run flow calls — CI, e2e,
 * reconfiguring in place — so it is named only in the command reference, and `npm i -g` is named nowhere a person
 * reads. Every guide, starter policy, harness text and the shipped content is held to that here.
 *
 * And the harness: the nine agent instruction files are RENDERED from agent/session-protocol.md, so the protocol's
 * wording reaches every one of them identically (render parity), and the framework repo's own copy of the protocol is
 * the shipped one byte for byte.
 */
import { expect } from "chai";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const CONTENT = fileURLToPath(new URL("../../../../content/", import.meta.url));
const REPO = fileURLToPath(new URL("../../../../../", import.meta.url));

/** The machine verb, and the npm install a person never runs by hand. */
const MACHINE = /gov setup|npm i -g/;
/** The one file that names them: the command reference, generated from the CLI itself. */
const ALLOWED = new Set([
  "framework/common/reference/gov-command-reference.md",
  "framework/rules/W2-classification.md", // a working paper of its time, never shipped (frozen POL allow-list)
]);

function walk(dir: string, rel = ""): string[] {
  return fs.readdirSync(path.join(dir, rel), { withFileTypes: true }).flatMap((e) => {
    const r = rel ? `${rel}/${e.name}` : e.name;
    return e.isDirectory() ? walk(dir, r) : [r];
  });
}

const HARNESS = [
  "AGENTS.md", "CLAUDE.md", "CONVENTIONS.md", "GEMINI.md", ".cursor/rules/agent.mdc", ".clinerules/agent.md",
  ".windsurf/rules/agent.md", ".github/copilot-instructions.md", ".continue/rules/agent.md",
].map((h) => `agent/harness/${h}`);

describe("one entry point for people (spec 01 §3.10, I01.5, L09)", () => {
  it("no shipped content names `gov setup` or `npm i -g`, except the command reference", () => {
    const hits: string[] = [];
    for (const rel of walk(CONTENT)) {
      if (ALLOWED.has(rel)) continue;
      fs.readFileSync(path.join(CONTENT, rel), "utf8").split("\n").forEach((l, i) => {
        if (MACHINE.test(l)) hits.push(`${rel}:${i + 1}: ${l.trim().slice(0, 140)}`);
      });
    }
    expect(hits).to.deep.equal([]);
  });

  it("the command reference still names `gov setup` — the machine verb has one home", () => {
    expect(fs.readFileSync(path.join(CONTENT, "framework/common/reference/gov-command-reference.md"), "utf8")).to.match(/gov setup/);
  });

  it("the guides a person starts from name the door: install.sh, then the first-run flow (adopt / join / not sure)", () => {
    for (const g of ["framework/common/guides/path-adopter.md", "framework/common/guides/path-joiner.md",
      "framework/common/guides/setting-up-your-machine.md", "framework/build/guides/working-on-a-project.md"]) {
      const t = fs.readFileSync(path.join(CONTENT, g), "utf8");
      expect(t, g).to.contain("install.sh");
      expect(t, g).to.contain("first-run flow (adopt / join / not sure)");
      expect(t, `${g} names the Windows door`).to.match(/on Windows, the installer/i);
    }
  });

  describe("harness render parity — the 9 targets carry the protocol's wording", () => {
    const protocol = fs.readFileSync(path.join(CONTENT, "agent/session-protocol.md"), "utf8");

    it("the framework repo's agent/session-protocol.md is the shipped one, byte for byte", () => {
      expect(fs.readFileSync(path.join(REPO, "agent/session-protocol.md"), "utf8")).to.equal(protocol);
    });

    const line = protocol.split("\n").find((l) => l.includes("first-run flow"));
    it("the protocol names the first-run flow, not the machine verb", () => {
      expect(line, "no first-run line in the protocol").to.not.equal(undefined);
      expect(protocol).to.not.match(MACHINE);
    });

    for (const h of HARNESS) {
      it(`${h} carries it identically`, () => {
        const t = fs.readFileSync(path.join(CONTENT, h), "utf8");
        expect(t).to.contain(line!);
        expect(t).to.not.match(MACHINE);
      });
    }
  });
});

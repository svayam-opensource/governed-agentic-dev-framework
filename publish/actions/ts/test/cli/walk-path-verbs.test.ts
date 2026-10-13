// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * THE WALK PATH, VERB BY VERB (PRJ-121 plan 04 T08, #257, ruling Q15 B).
 *
 * The timed adopter walk is told one link and nothing else. Every gov verb it meets must therefore be one the
 * walker is TAKEN to — run for them by install.sh or by gov, offered in gov's menu, or printed by gov at the
 * moment it is needed. A verb the walker would have to know already is a blocker on the walk.
 *
 * The list below is the `walk-verbs` block of the walk script (svm-prj-work, PRJ-121
 * knowledge/walks/WALK-SCRIPT.md), one verb per line, `<step> <who> <command>`. It is copied here because the walk
 * script lives in another repository; change both together. Each command must have an entry in REACH, and each
 * entry checks the place the walker meets it.
 *
 * Off the walk path (Q15): every other verb — they are listed for deferral in the walk-path review, not tested here.
 */
import { expect } from "chai";
import * as fs from "node:fs";
import { fileURLToPath } from "node:url";
import { COMMAND_SPECS } from "../../src/cli/help-spec.js";
import { visibleActions, formatMainMenu, type ContextMode } from "../../src/cli/menu.js";
import { adopterNextSteps } from "../../src/cli/next-steps.js";

const WALK_VERBS = `
1 walker  -
2 install gov --version
3 install gov doctor --fix
4 install gov
4 gov     gov setup <org>/<repo>
5 gov     gov agent install <id>
6 gov     gov work
6 gov     gov seed <board-url>
6 walker  gov
6 walker  gov work
`;

interface WalkVerb { readonly step: number; readonly who: "walker" | "install" | "gov"; readonly command: string }
const walkVerbs = (block: string): WalkVerb[] => block.split("\n").map((l) => l.trim()).filter(Boolean).map((l) => {
  const m = /^(\d+)\s+(walker|install|gov)\s+(.+)$/.exec(l);
  if (!m) throw new Error(`walk-verbs: unparsable line '${l}'`);
  return { step: Number(m[1]), who: m[2] as WalkVerb["who"], command: m[3]!.trim() };
}).filter((v) => v.command !== "-");

const src = (rel: string): string => fs.readFileSync(fileURLToPath(new URL(`../../${rel}`, import.meta.url)), "utf8");
const installSh = (): string => fs.readFileSync(fileURLToPath(new URL("../../../../../install.sh", import.meta.url)), "utf8");
/** install.sh lines that RUN something: no comments, no `say` text. */
const installRunLines = (): string[] => installSh().split("\n").filter((l) => !/^\s*#/.test(l) && !/^\s*say\b/.test(l));
const MODES: readonly ContextMode[] = ["none", "governed", "project"];

/** Where the walker meets each command, and the check that they do. Keyed by `<who> <command>`. */
const REACH: Record<string, () => void> = {
  "install gov --version": () => {
    expect(installRunLines().some((l) => /\bgov --version\b/.test(l)), "install.sh runs `gov --version`").to.equal(true);
  },
  "install gov doctor --fix": () => {
    expect(installRunLines().some((l) => /^\s*gov doctor --fix < \/dev\/tty/.test(l)), "install.sh runs `gov doctor --fix` on the terminal").to.equal(true);
    // With no terminal it cannot run it, so it NAMES it at the point of need.
    expect(installSh()).to.match(/say "\s+\$\{B\}gov doctor --fix\$\{RST\}"/);
  },
  "install gov": () => {
    // The hand-over to the first-run flow is BARE gov: the role question on a new machine, the menu on a set-up one —
    // the same thing install.sh's last word tells them to type.
    expect(installRunLines().some((l) => /^\s*gov < \/dev\/tty/.test(l)), "install.sh hands over with bare `gov`").to.equal(true);
    expect(installSh()).to.match(/Run \$\{B\}gov\$\{RST\} on its own to open the menu/);
  },
  "gov gov setup <org>/<repo>": () => {
    // The adopt interview's last act is `gov setup <org>/<repo>`, run by gov itself (createWorkspace).
    expect(src("src/cli/main.ts")).to.match(/createWorkspace: \(target, pre\) => runSetupCommand\(\["setup", target\]/);
    expect(src("src/cli/bootstrap.ts")).to.match(/await io\.createWorkspace\(target/);
  },
  "gov gov agent install <id>": () => {
    // The work flow installs a chosen agent through the same path as `gov agent install`, and names the command
    // when it cannot do it itself.
    const wf = src("src/cli/work-flow.ts");
    expect(wf).to.match(/deps\.installAgent\(row\.id/);
    expect(wf).to.match(/Install it with: {2}gov agent install \$\{row\.id\}/);
    expect(src("src/cli/bin.ts")).to.match(/argv\[0\] === "agent" && argv\[1\] === "install"\) return runAgentInstall/);
  },
  "gov gov work": () => {
    // "Review your governance policies now?" — yes runs the Work flow on the starter project.
    expect(src("src/cli/bootstrap.ts")).to.match(/review your governance policies now/);
    expect(src("src/cli/main.ts")).to.match(/reviewNow: async \(role\) => \{[\s\S]{0,2000}?return await runWorkFlow\(/);
  },
  "gov gov seed <board-url>": () => {
    // A not-yet-started project chosen in Work is seeded by the work flow; nobody types `gov seed`.
    expect(src("src/cli/work-flow.ts")).to.match(/Initializing '\$\{p\.title\}' \(seed → branch → clone\)/);
  },
  "walker gov": () => {
    // Bare gov on a set-up machine is the menu, and its first action is Work — in every context.
    for (const mode of MODES) expect(formatMainMenu({ mode }).join("\n"), mode).to.match(/\(1\) Work/);
  },
  "walker gov work": () => {
    // `gov work` is the menu's Work action, and the adoption's last screen and the declined offer both say so.
    for (const mode of MODES) expect(visibleActions({ mode })[0], mode).to.include({ kind: "guided", key: "work" });
    const steps = adopterNextSteps({ githubOrg: "acme", workspaceRepo: "acme-gov", orgSlug: "ACME", workspacePath: "" }).join("\n");
    expect(steps).to.match(/Run: {2}gov\n/);
    expect(steps).to.match(/Choose {2}1\. Work/);
    expect(src("src/cli/bootstrap.ts")).to.match(/When you are ready: {2}gov {3}→ 1\. Work/);
  },
};

describe("walk path: every verb the walk uses is reachable where the walker meets it (#257, Q15 B)", () => {
  const verbs = walkVerbs(WALK_VERBS);

  it("the walk script names at least one verb per step from 2 to 6", () => {
    for (const s of [2, 3, 4, 5, 6]) expect(verbs.some((v) => v.step === s), `step ${s}`).to.equal(true);
  });

  it("every command is one gov has — a documented verb, bare gov, or --version", () => {
    const known = new Set(COMMAND_SPECS.map((c) => c.name));
    for (const v of verbs) {
      const word = v.command.split(/\s+/)[1];
      if (word === undefined || word === "--version") continue;
      expect(known.has(word), `'${v.command}' (step ${v.step}): '${word}' has no help spec — the walker cannot look it up`).to.equal(true);
    }
  });

  for (const v of walkVerbs(WALK_VERBS)) {
    it(`step ${v.step}: \`${v.command}\` (${v.who}) is reached, not recalled`, () => {
      const check = REACH[`${v.who} ${v.command}`];
      expect(check, `no reach check for '${v.who} ${v.command}' — add one, or take it off the walk`).to.be.a("function");
      check!();
    });
  }
});

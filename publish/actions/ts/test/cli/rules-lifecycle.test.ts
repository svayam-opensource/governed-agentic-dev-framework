// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * THE COMPILER, RUN AUTOMATICALLY (design §7) — and every way that could be worse than not running it.
 *
 * The verb existed and nothing called it, so these tests are about the WIRING rather than the compiling
 * (`test/rules/rules-build.test.ts` covers that): does a moment actually render, does it read the right source,
 * does a question stop the write without stopping the command, and is the marker recorded at exactly the two
 * moments where a session can be stale.
 */
import { expect } from "chai";
import * as path from "node:path";
import { buildRulesAt } from "../../src/cli/rules-lifecycle.js";
import { clearPending, readPending } from "../../src/rules-pending.js";
import { PROTOCOL_MARKER, RESIDENT_PLACEHOLDER } from "../../src/rules/harness-render.js";
import type { Fs } from "../../src/lifecycle/fs-io.js";
import { parseClauses } from "../../src/rules/notation.js";
import { clauseSha, parseCueBlocks } from "../../src/rules/cue-block.js";
import { px } from "../helpers/paths.js";

const HOME = "/gov";
const PROTOCOL = path.join("agent", "session-protocol.md");
const RENDERED_CLAUDE = path.join("agent", "harness", "CLAUDE.md");

/** A policy document with one levelled clause and one cue, with the clause-sha the compiler will check. */
function policy(cue: string, clause = "An agent MUST hard stop on a C01 breach."): string {
  const text = `### 1.1 Levels\n\n${clause} **(POL-011)**\n\n<!-- gov:cue generated clause-sha=PLACEHOLDER -->\n> **Always in the agent's context** · POL-011 · C01\n> ${cue}\n`;
  const { clauses } = parseClauses("d.md", text);
  const { blocks } = parseCueBlocks("d.md", text);
  const owner = [...clauses].filter((c) => c.line < blocks[0]!.line).pop()!;
  return text.replace("PLACEHOLDER", clauseSha(owner.text));
}

const PROTOCOL_BODY = `# Agent protocol\n\n<!-- ${PROTOCOL_MARKER}: 3 -->\n\n${RESIDENT_PLACEHOLDER}\n`;

/**
 * A disk that supports `readdir` by prefix, because `readPolicyDocs --working-tree` lists the policy roots.
 * Keys are POSIX; `px` normalises what production hands in, so the doubles work on Windows too.
 */
function memFs(seed: Record<string, string>): Fs & { readonly files: Map<string, string> } {
  const files = new Map(Object.entries(seed).map(([k, v]) => [px(k), v]));
  return {
    files,
    pathExists: (p) => files.has(px(p)),
    readFile: (p) => files.get(px(p)) ?? null,
    writeFile: (p, c) => { files.set(px(p), c); },
    rm: (p) => { files.delete(px(p)); },
    mkdirp: () => {},
    readdir: (dir) => {
      const prefix = `${px(dir).replace(/\/+$/, "")}/`;
      return [...new Set([...files.keys()].filter((f) => f.startsWith(prefix)).map((f) => f.slice(prefix.length).split("/")[0]!))];
    },
  };
}

const workspace = (cue = "C01 MEANS STOP."): Record<string, string> => ({
  [`${HOME}/policies/org-policy.md`]: policy(cue),
  [`${HOME}/${PROTOCOL}`]: PROTOCOL_BODY,
});

const MARKER = { workRoot: "/awr", login: "rkant", now: () => new Date("2026-09-28T10:12:44.000Z") };
const WORKING_TREE = { home: HOME, defaultBranch: "main", workingTree: true } as const;

describe("rules at setup — the adopter's first copy", () => {
  it("renders the nine agent files and the rule map, so nobody has to know the verb exists", () => {
    const fs = memFs(workspace());
    const r = buildRulesAt({ fs }, WORKING_TREE, "setup");
    expect(r.failed, r.lines.join("\n")).to.equal(false);
    expect(r.asked).to.equal(false);
    expect(fs.readFile(path.join(HOME, RENDERED_CLAUDE))).to.contain("C01 MEANS STOP.");
    expect(fs.readFile(path.join(HOME, "agent", "harness", ".cursor", "rules", "agent.mdc"))).to.contain("alwaysApply: true");
    expect(fs.readFile(path.join(HOME, "agent", "harness", "rule-map.md"))).to.not.equal(null);
  });

  it("writes the POL lock beside the policies it locks", () => {
    const fs = memFs(workspace());
    buildRulesAt({ fs }, WORKING_TREE, "setup");
    expect(fs.readFile(path.join(HOME, "policies", ".pol-lock.json"))).to.contain("POL-");
  });

  it("records NO marker — a brand-new workspace whose first `gov task` refuses reads as gov being broken", () => {
    const fs = memFs(workspace());
    const r = buildRulesAt({ fs, marker: MARKER }, WORKING_TREE, "setup");
    expect(r.pendingRecorded).to.equal(false);
    expect(readPending(fs, MARKER.workRoot, MARKER.login)).to.equal(null);
  });

  it("says the source out loud, so nobody reads a working-tree compile as a ratified one", () => {
    const r = buildRulesAt({ fs: memFs(workspace()) }, WORKING_TREE, "setup");
    expect(r.lines.join("\n")).to.contain("working tree");
  });
});

describe("rules at sync and upgrade — a changed rule records the marker", () => {
  /** Render once, then change the cue's text and render again — the mid-project case §8 is about. */
  function twice(moment: "sync" | "upgrade"): { fs: ReturnType<typeof memFs>; second: ReturnType<typeof buildRulesAt> } {
    const fs = memFs(workspace("C01 MEANS STOP."));
    buildRulesAt({ fs, marker: MARKER }, WORKING_TREE, moment);
    fs.writeFile(path.join(HOME, "policies", "org-policy.md"), policy("C01 MEANS STOP, AND SAY WHY."));
    return { fs, second: buildRulesAt({ fs, marker: MARKER }, WORKING_TREE, moment) };
  }

  it("names the clause whose resident text changed", () => {
    const { second } = twice("sync");
    expect(second.changed).to.deep.equal(["POL-011 · C01"]);
  });

  it("writes state/rules-pending with the new hash, the old one and the changed clauses", () => {
    const { fs, second } = twice("sync");
    const pending = readPending(fs, MARKER.workRoot, MARKER.login)!;
    expect(second.pendingRecorded).to.equal(true);
    expect(pending.hash).to.equal(second.hash);
    expect(pending.previous).to.be.a("string").and.not.equal(pending.hash);
    expect(pending.clauses).to.deep.equal(["POL-011 · C01"]);
    expect(pending.at).to.equal("2026-09-28T10:12:44.000Z");
    expect(pending.by).to.equal("sync");
  });

  it("does the same at upgrade, which is the other moment the rules come into force", () => {
    const { fs, second } = twice("upgrade");
    expect(second.pendingRecorded).to.equal(true);
    expect(readPending(fs, MARKER.workRoot, MARKER.login)!.by).to.equal("upgrade");
  });

  it("the FIRST render in a workspace counts as a change — the context went from no rules to rules", () => {
    const fs = memFs(workspace());
    const first = buildRulesAt({ fs, marker: MARKER }, WORKING_TREE, "sync");
    expect(first.pendingRecorded).to.equal(true);
    expect(readPending(fs, MARKER.workRoot, MARKER.login)!.previous).to.equal(null);
    expect(first.lines.join("\n")).to.contain("nothing was rendered before");
  });

  it("records NOTHING when the bytes are identical — otherwise every sync would close the mutating verbs", () => {
    const fs = memFs(workspace());
    buildRulesAt({ fs, marker: MARKER }, WORKING_TREE, "sync");
    clearPending(fs, MARKER.workRoot, MARKER.login);                 // as `gov work` would, on the next launch
    const again = buildRulesAt({ fs, marker: MARKER }, WORKING_TREE, "sync");
    expect(again.pendingRecorded).to.equal(false);
    expect(again.changed).to.deep.equal([]);
    expect(again.lines.join("\n")).to.contain("rules unchanged");
    expect(readPending(fs, MARKER.workRoot, MARKER.login)).to.equal(null);
  });

  it("records nothing when gov does not know whose session it is — the writer and reader key the same way", () => {
    const fs = memFs(workspace("C01 MEANS STOP."));
    buildRulesAt({ fs }, WORKING_TREE, "sync");
    fs.writeFile(path.join(HOME, "policies", "org-policy.md"), policy("SOMETHING ELSE ENTIRELY."));
    const second = buildRulesAt({ fs }, WORKING_TREE, "sync");
    expect(second.changed).to.have.length(1);
    expect(second.pendingRecorded, "no login → no marker written, and none would be found either").to.equal(false);
  });

  it("tells the person what is now closed and both ways to re-open it", () => {
    const { second } = twice("sync");
    const out = second.lines.join("\n");
    expect(out).to.contain("task · merge · close · knowledge propose are CLOSED");
    expect(out).to.contain("gov work");
    expect(out).to.contain("gov rules reload");
  });
});

describe("rules at a lifecycle moment — reading the DEFAULT BRANCH, never the project branch", () => {
  it("compiles what git shows at the ratified ref, not what is in the worktree (POL-086b)", () => {
    // The worktree holds a clause nobody ratified; the default branch holds the real one. A compile that
    // preferred the worktree would deliver the unratified cue into every agent's context.
    const fs = memFs({
      [`${HOME}/policies/org-policy.md`]: policy("A RULE I WROTE ON MY OWN BRANCH."),
      [`${HOME}/${PROTOCOL}`]: PROTOCOL_BODY,
    });
    const ratified = policy("THE RATIFIED RULE.");
    const git = (_repo: string, args: readonly string[]): string | null => {
      if (args[0] === "ls-tree") return "policies/org-policy.md";
      if (args[0] === "show") return ratified;
      return null;
    };
    const r = buildRulesAt({ fs, git }, { home: HOME, defaultBranch: "main" }, "sync");
    expect(r.failed, r.lines.join("\n")).to.equal(false);
    const rendered = fs.readFile(path.join(HOME, RENDERED_CLAUDE))!;
    expect(rendered).to.contain("THE RATIFIED RULE.");
    expect(rendered, "a branch edit is a proposal, not governance").to.not.contain("ON MY OWN BRANCH");
  });
});

describe("rules at a lifecycle moment — a question stops the write, never the command", () => {
  it("surfaces the question, writes nothing, and does not report failure", () => {
    const fs = memFs(workspace());
    buildRulesAt({ fs }, WORKING_TREE, "sync");                      // allocate POL-011
    const rendered = fs.readFile(path.join(HOME, RENDERED_CLAUDE));
    // Reword the CLAUSE (not the cue): the compiler cannot tell whether POL-011 still names it.
    fs.writeFile(path.join(HOME, "policies", "org-policy.md"), policy("C01 MEANS STOP.", "An agent MUST hard stop on any C01 breach whatsoever."));
    const r = buildRulesAt({ fs, marker: MARKER }, WORKING_TREE, "sync");
    expect(r.asked).to.equal(true);
    expect(r.failed, "a numbering question is not a failure of sync").to.equal(false);
    expect(fs.readFile(path.join(HOME, RENDERED_CLAUDE)), "nothing may be written while a question is open").to.equal(rendered);
    expect(readPending(fs, MARKER.workRoot, MARKER.login), "no render, so no session went stale").to.equal(null);
  });

  it("prints the `--confirm` command the verb itself would print, so the two never diverge", () => {
    const fs = memFs(workspace());
    buildRulesAt({ fs }, WORKING_TREE, "sync");
    fs.writeFile(path.join(HOME, "policies", "org-policy.md"), policy("C01 MEANS STOP.", "An agent MUST hard stop on any C01 breach whatsoever."));
    const out = buildRulesAt({ fs }, WORKING_TREE, "sync").lines.join("\n");
    expect(out).to.contain("gov rules build --confirm POL-");
  });

  it("at SYNC it says the project keeps the rules it had — the one moment allowed to end un-built", () => {
    const fs = memFs(workspace());
    buildRulesAt({ fs }, WORKING_TREE, "sync");
    fs.writeFile(path.join(HOME, "policies", "org-policy.md"), policy("C01 MEANS STOP.", "An agent MUST hard stop on any C01 breach whatsoever."));
    expect(buildRulesAt({ fs }, WORKING_TREE, "sync").lines.join("\n"))
      .to.contain("keeps the rules it already had");
  });

  it("at SETUP and UPGRADE it says the harness is NOT compiled from the policies — a reported defect", () => {
    for (const moment of ["setup", "upgrade"] as const) {
      const fs = memFs(workspace());
      buildRulesAt({ fs }, WORKING_TREE, moment);
      fs.writeFile(path.join(HOME, "policies", "org-policy.md"), policy("C01 MEANS STOP.", "An agent MUST hard stop on any C01 breach whatsoever."));
      expect(buildRulesAt({ fs }, WORKING_TREE, moment).lines.join("\n"), moment)
        .to.contain("harness is NOT compiled");
    }
  });
});

describe("rules at a lifecycle moment — a workspace with no policy at all", () => {
  it("says NOTHING and reports skipped: a command behaves exactly as it did before any of this existed", () => {
    const fs = memFs({ [`${HOME}/${PROTOCOL}`]: PROTOCOL_BODY });
    const r = buildRulesAt({ fs }, WORKING_TREE, "sync");
    expect(r.skipped).to.equal(true);
    expect(r.failed).to.equal(false);
    expect(r.lines).to.deep.equal([]);
  });
});

describe("rules at a lifecycle moment — what it says when it cannot render", () => {
  it("a missing protocol body is reported with the command that explains it, and nothing is claimed", () => {
    const fs = memFs({ [`${HOME}/policies/org-policy.md`]: policy("C01 MEANS STOP.") });
    const r = buildRulesAt({ fs }, WORKING_TREE, "setup");
    expect(r.failed).to.equal(true);
    expect(r.hash).to.equal(null);
    expect(r.lines.join("\n")).to.contain("session-protocol.md is missing");
    expect(r.lines.join("\n")).to.contain("gov rules report");
  });
});

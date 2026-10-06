// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * THE BUILD, RUN AUTOMATICALLY (design §7) — and `gov rules build|check|report` over the rule stores (P3 cutover).
 *
 * The verb existed and nothing called it, so most of these tests are about the WIRING: does a moment actually
 * render, does it read the right source, does a rules problem stop the write without stopping the command, and is
 * the marker recorded at exactly the two moments where a session can be stale. The last groups pin the verb: the
 * rule map is written, `check` fails on a stale file and on a stale row, and a resident tier over its cap refuses.
 */
import { expect } from "chai";
import * as path from "node:path";
import { buildRulesAt } from "../../src/cli/rules-lifecycle.js";
import { rules, rulesFacts } from "../../src/cli/rules-verb.js";
import { clearPending, readPending } from "../../src/rules-pending.js";
import { PROTOCOL_MARKER, RESIDENT_PLACEHOLDER } from "../../src/rules/harness-render.js";
import { RESIDENT_CAP } from "../../src/rules/cues/resident.js";
import { sectionShas } from "../../src/rules/checks/sections.js";
import type { Fs } from "../../src/lifecycle/fs-io.js";
import { SHIPPED_CATALOG } from "../helpers/rule-store.js";
import { px } from "../helpers/paths.js";

const HOME = "/gov";
const PROTOCOL = path.join("agent", "session-protocol.md");
const RENDERED_CLAUDE = path.join("agent", "harness", "CLAUDE.md");
const RULE_MAP = path.join("agent", "harness", "rule-map.md");
const SPEC = "framework/docs/specs/framework-specification.md";
const SPEC_TEXT = "# Spec\n\n## 10 Levels\n\n### 10.1 C01\n\nA C01 breach is a hard stop.\n";
const SHA = sectionShas(SPEC_TEXT).get("10.1")!;

/** One resident framework rule, as the framework store writes it. */
const row = (id: string, cue: string, sha = SHA): string => `- id: ${id}
  source: { doc: ${SPEC}, section: "10.1", sha: "${sha}" }
  expectation: "The agent stops all work when a C01 rule is broken."
  actor: [agent]
  level: C01
  cue: { tier: resident, text: "${cue}" }
  start: { version: "1.2.3", date: "2026-10-06" }
  end: null
`;
const store = (cue: string): string => row("GOV-FRM-012", cue);

const PROTOCOL_BODY = `# Agent protocol\n\n<!-- ${PROTOCOL_MARKER}: 3 -->\n\n${RESIDENT_PLACEHOLDER}\n`;

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

const workspace = (cue = "C01 MEANS STOP.", rows = store(cue)): Record<string, string> => ({
  [`${HOME}/org-config.yaml`]: "org_slug: SVM\n",
  [`${HOME}/framework/rules/rules.yaml`]: rows,
  [`${HOME}/framework/rules/catalog.yaml`]: SHIPPED_CATALOG,
  [`${HOME}/policies/rules.yaml`]: "[]\n",
  [`${HOME}/${SPEC}`]: SPEC_TEXT,
  [`${HOME}/${PROTOCOL}`]: PROTOCOL_BODY,
});

const MARKER = { workRoot: "/awr", login: "rkant", now: () => new Date("2026-09-28T10:12:44.000Z") };
const WORKING_TREE = { home: HOME, defaultBranch: "main", workingTree: true } as const;
const setRows = (fs: Fs, rows: string): void => fs.writeFile(path.join(HOME, "framework", "rules", "rules.yaml"), rows);

describe("rules at setup — the adopter's first copy", () => {
  it("renders the nine agent files and the rule map from the rule rows, so nobody has to know the verb exists", () => {
    const fs = memFs(workspace());
    const r = buildRulesAt({ fs }, WORKING_TREE, "setup");
    expect(r.failed, r.lines.join("\n")).to.equal(false);
    expect(fs.readFile(path.join(HOME, RENDERED_CLAUDE))).to.contain("- GOV-FRM-012 · C01 MEANS STOP.");
    expect(fs.readFile(path.join(HOME, "agent", "harness", ".cursor", "rules", "agent.mdc"))).to.contain("alwaysApply: true");
    expect(fs.readFile(path.join(HOME, RULE_MAP))).to.contain("| GOV-FRM-012 |");
  });

  it("writes no POL lock — the numbering lock is retired with the old compiler", () => {
    const fs = memFs(workspace());
    buildRulesAt({ fs }, WORKING_TREE, "setup");
    expect([...fs.files.keys()].filter((f) => f.includes(".pol-lock"))).to.deep.equal([]);
  });

  it("records NO marker — a brand-new workspace whose first `gov task` refuses reads as gov being broken", () => {
    const fs = memFs(workspace());
    const r = buildRulesAt({ fs, marker: MARKER }, WORKING_TREE, "setup");
    expect(r.pendingRecorded).to.equal(false);
    expect(readPending(fs, MARKER.workRoot, MARKER.login)).to.equal(null);
  });

  it("says the source out loud, so nobody reads a working-tree render as a ratified one", () => {
    const r = buildRulesAt({ fs: memFs(workspace()) }, WORKING_TREE, "setup");
    expect(r.lines.join("\n")).to.contain("working tree");
  });
});

describe("rules at sync and upgrade — a changed resident rule records the marker", () => {
  function twice(moment: "sync" | "upgrade"): { fs: ReturnType<typeof memFs>; second: ReturnType<typeof buildRulesAt> } {
    const fs = memFs(workspace("C01 MEANS STOP."));
    buildRulesAt({ fs, marker: MARKER }, WORKING_TREE, moment);
    setRows(fs, store("C01 MEANS STOP, AND SAY WHY."));
    return { fs, second: buildRulesAt({ fs, marker: MARKER }, WORKING_TREE, moment) };
  }

  it("names the rule whose resident cue changed, by GOV id", () => {
    expect(twice("sync").second.changed).to.deep.equal(["GOV-FRM-012"]);
  });

  it("writes state/rules-pending with the new hash, the old one and the changed rules", () => {
    const { fs, second } = twice("sync");
    const pending = readPending(fs, MARKER.workRoot, MARKER.login)!;
    expect(second.pendingRecorded).to.equal(true);
    expect(pending.hash).to.equal(second.hash);
    expect(pending.previous).to.be.a("string").and.not.equal(pending.hash);
    expect(pending.clauses).to.deep.equal(["GOV-FRM-012"]);
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
    clearPending(fs, MARKER.workRoot, MARKER.login);
    const again = buildRulesAt({ fs, marker: MARKER }, WORKING_TREE, "sync");
    expect(again.pendingRecorded).to.equal(false);
    expect(again.changed).to.deep.equal([]);
    expect(again.lines.join("\n")).to.contain("rules unchanged");
    expect(readPending(fs, MARKER.workRoot, MARKER.login)).to.equal(null);
  });

  it("records nothing when gov does not know whose session it is — the writer and reader key the same way", () => {
    const fs = memFs(workspace("C01 MEANS STOP."));
    buildRulesAt({ fs }, WORKING_TREE, "sync");
    setRows(fs, store("SOMETHING ELSE ENTIRELY."));
    const second = buildRulesAt({ fs }, WORKING_TREE, "sync");
    expect(second.changed).to.have.length(1);
    expect(second.pendingRecorded, "no login → no marker written, and none would be found either").to.equal(false);
  });

  it("tells the person what is now closed and both ways to re-open it", () => {
    const out = twice("sync").second.lines.join("\n");
    expect(out).to.contain("task · merge · close · knowledge propose are CLOSED");
    expect(out).to.contain("gov work");
    expect(out).to.contain("gov rules reload");
  });
});

describe("rules at a lifecycle moment — reading the DEFAULT BRANCH, never the project branch", () => {
  it("renders the rows git shows at the ratified ref, not what is in the worktree (GOV-FRM-086)", () => {
    const fs = memFs(workspace("A RULE I WROTE ON MY OWN BRANCH."));
    const ratified = workspace("THE RATIFIED RULE.");
    const git = (_repo: string, args: readonly string[]): string | null => {
      if (args[0] === "ls-tree") return Object.keys(ratified).map((k) => k.slice(HOME.length + 1)).join("\n");
      if (args[0] === "show") return ratified[`${HOME}/${args[1]!.split(/:(.*)/s)[1]}`] ?? null;
      return null;
    };
    const r = buildRulesAt({ fs, git }, { home: HOME, defaultBranch: "main" }, "sync");
    expect(r.failed, r.lines.join("\n")).to.equal(false);
    const rendered = fs.readFile(path.join(HOME, RENDERED_CLAUDE))!;
    expect(rendered).to.contain("THE RATIFIED RULE.");
    expect(rendered, "a branch edit is a proposal, not governance").to.not.contain("ON MY OWN BRANCH");
  });
});

describe("rules at a lifecycle moment — a rules problem stops the write, never the command", () => {
  it("a row error is reported, nothing is written, and the command is not failed by it", () => {
    const fs = memFs(workspace());
    buildRulesAt({ fs }, WORKING_TREE, "sync");
    const rendered = fs.readFile(path.join(HOME, RENDERED_CLAUDE));
    setRows(fs, store("C01 MEANS STOP.").replace("level: C01", "level: C02"));   // a framework rule is never C02
    const r = buildRulesAt({ fs, marker: MARKER }, WORKING_TREE, "sync");
    expect(r.failed).to.equal(true);
    expect(r.lines.join("\n")).to.contain("NOT rendered");
    expect(fs.readFile(path.join(HOME, RENDERED_CLAUDE)), "nothing may be written over a broken store").to.equal(rendered);
    expect(readPending(fs, MARKER.workRoot, MARKER.login), "no render, so no session went stale").to.equal(null);
  });

  it("a resident tier over its cap fails the build — it never truncates the rules an owner approved", () => {
    const rows = Array.from({ length: RESIDENT_CAP + 1 }, (_, i) => row(`GOV-FRM-${String(500 + i)}`, `CUE ${i}.`)).join("");
    const r = buildRulesAt({ fs: memFs(workspace("x", rows)) }, WORKING_TREE, "setup");
    expect(r.failed).to.equal(true);
    expect(r.lines.join("\n")).to.contain(`exceed the cap of ${RESIDENT_CAP}`);
  });
});

describe("rules at a lifecycle moment — a workspace with no rule store at all", () => {
  it("says NOTHING and reports skipped: a command behaves exactly as it did before any of this existed", () => {
    const fs = memFs({ [`${HOME}/${PROTOCOL}`]: PROTOCOL_BODY, [`${HOME}/org-config.yaml`]: "org_slug: SVM\n" });
    const r = buildRulesAt({ fs }, WORKING_TREE, "sync");
    expect(r.skipped).to.equal(true);
    expect(r.failed).to.equal(false);
    expect(r.lines).to.deep.equal([]);
  });

  it("a missing protocol body is reported with the command that explains it, and nothing is claimed", () => {
    const seed = workspace();
    delete seed[`${HOME}/${PROTOCOL}`];
    const r = buildRulesAt({ fs: memFs(seed) }, WORKING_TREE, "setup");
    expect(r.failed).to.equal(true);
    expect(r.hash).to.equal(null);
    expect(r.lines.join("\n")).to.contain("session-protocol.md is missing");
    expect(r.lines.join("\n")).to.contain("gov rules report");
  });
});

describe("gov rules check — the generated files AND the rows", () => {
  it("passes on a fresh build, and fails once a generated file is edited by hand", () => {
    const fs = memFs(workspace());
    expect(rules({ fs }, WORKING_TREE, "build").code).to.equal(0);
    expect(rules({ fs }, WORKING_TREE, "check").code).to.equal(0);
    fs.writeFile(path.join(HOME, RULE_MAP), "edited\n");
    const r = rules({ fs }, WORKING_TREE, "check");
    expect(r.code).to.equal(1);
    expect(r.lines.join("\n")).to.contain("agent/harness/rule-map.md");
  });

  it("fails on a STALE ROW — its source section changed since the row was approved — and names it (Q9)", () => {
    const fs = memFs(workspace());
    rules({ fs }, WORKING_TREE, "build");
    fs.writeFile(path.join(HOME, SPEC), SPEC_TEXT.replace("hard stop", "hard stop, reported at once"));
    const r = rules({ fs }, WORKING_TREE, "check");
    expect(r.code).to.equal(1);
    const out = r.lines.join("\n");
    expect(out).to.contain("pending re-review");
    expect(out).to.contain(`GOV-FRM-012  ${SPEC} §10.1  ${SHA} →`);
    expect(out).to.contain("gov rules propose");
  });

  it("a row whose section is gone is stale too, and says so", () => {
    const fs = memFs(workspace());
    fs.writeFile(path.join(HOME, SPEC), "# Spec\n");
    expect(rules({ fs }, WORKING_TREE, "report").lines.join("\n")).to.contain("section gone");
  });
});

describe("gov rules report and doctor — counts from the rule model", () => {
  it("report prints the in-force count per class, and the resident tier against its cap", () => {
    const out = rules({ fs: memFs(workspace()) }, WORKING_TREE, "report").lines.join("\n");
    expect(out).to.contain("1 rule(s) in force — 1 framework · 0 organization");
    expect(out).to.contain("cued 1");
    expect(out).to.contain(`1 resident cue(s) in every agent's context (cap ${RESIDENT_CAP})`);
  });

  it("doctor's facts come from summariseRuleSet, and name stale files and stale rows", () => {
    const fs = memFs(workspace());
    const facts = rulesFacts({ fs }, WORKING_TREE);
    expect(facts && !("error" in facts)).to.equal(true);
    const f = facts as Exclude<typeof facts, undefined | { error: string }>;
    expect(f.counts.cued).to.equal(1);
    expect(f.resident).to.equal(1);
    expect(f.staleFiles.length, "nothing built yet").to.equal(10);
    expect(f.staleRows).to.deep.equal([]);
  });

  it("doctor has no rules facts in a workspace with no rule store", () => {
    expect(rulesFacts({ fs: memFs({ [`${HOME}/${PROTOCOL}`]: PROTOCOL_BODY }) }, WORKING_TREE)).to.equal(undefined);
  });
});

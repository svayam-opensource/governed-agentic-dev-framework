// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
//
// W7 — CUES FROM RULE ROWS (rule-model-design.md Q11, Q19). The resident tier (C01 + an agent, hard-capped, never
// truncated), the on-demand tier (keyed by the same resource/event as the check), and the message a HUMAN sees at
// a gate (no cue — the rule itself).
import { expect } from "chai";
import type { RuleRow } from "../../../src/rules/model/rule-row.js";
import type { RuleSet } from "../../../src/rules/model/contracts.js";
import type { CheckBinding } from "../../../src/rules/model/catalog.js";
import { renderResidentBlock, residentRows, RESIDENT_CAP } from "../../../src/rules/cues/resident.js";
import { onDemandCues } from "../../../src/rules/cues/on-demand.js";
import { humanGateMessage } from "../../../src/rules/cues/human-message.js";
import { carriesResidentBlock } from "../../../src/rules/harness-render.js";

const row = (id: string, over: Partial<RuleRow> = {}): RuleRow => ({
  id,
  source: { doc: "policies/org-policy.md", section: "3.1", sha: "a1b2c3" },
  expectation: `Everyone MUST do the thing ${id} asks.`,
  actor: ["everyone"],
  level: "C01",
  start: { version: "1.0.0", date: "2026-10-06" },
  end: null,
  ...over,
});
const resident = (id: string, text = `cue for ${id}`, over: Partial<RuleRow> = {}): RuleRow =>
  row(id, { cue: { tier: "resident", text }, ...over });
const set = (framework: RuleRow[], org: RuleRow[] = []): RuleSet => ({
  framework, org, orgScope: "SVM", orgVersion: "1.0.0", catalog: { resources: [], tools: [], actions: [] },
});
const closed = { version: "1.1.0", date: "2026-10-07" };

describe("cues — resident tier", () => {
  it("renders one line per rule, framework first then org, each sorted by id number", () => {
    const out = renderResidentBlock(set(
      [resident("GOV-FRM-010"), resident("GOV-FRM-002")],
      [resident("GOV-SVM-1000"), resident("GOV-SVM-003")],
    ));
    expect(out).to.be.a("string");
    const lines = (out as string).split("\n").filter((l) => l.startsWith("- "));
    expect(lines).to.deep.equal([
      "- GOV-FRM-002 · cue for GOV-FRM-002",
      "- GOV-FRM-010 · cue for GOV-FRM-010",
      "- GOV-SVM-003 · cue for GOV-SVM-003",
      "- GOV-SVM-1000 · cue for GOV-SVM-1000",
    ]);
  });

  it("is byte-stable whatever order the store holds the rows in", () => {
    const a = [resident("GOV-FRM-001"), resident("GOV-FRM-002"), resident("GOV-FRM-003")];
    const first = renderResidentBlock(set(a));
    expect(renderResidentBlock(set([...a].reverse()))).to.equal(first);
    expect(renderResidentBlock(set(a))).to.equal(first);
  });

  it("carries the lead the harness verifier looks for, and nothing else but rule lines", () => {
    const out = renderResidentBlock(set([resident("GOV-FRM-001")])) as string;
    expect(carriesResidentBlock(out)).to.equal(true);
    expect(out.endsWith("- GOV-FRM-001 · cue for GOV-FRM-001")).to.equal(true);
  });

  it("leaves out on-demand cues, cue-less rows and retired rows", () => {
    const rows = [
      resident("GOV-FRM-001"),
      row("GOV-FRM-002", { cue: { tier: "on-demand", text: "later" } }),
      row("GOV-FRM-003"),
      resident("GOV-FRM-004", "retired cue", { end: closed }),
    ];
    expect(residentRows(set(rows)).map((r) => r.id)).to.deep.equal(["GOV-FRM-001"]);
    expect(renderResidentBlock(set(rows))).to.not.include("retired cue");
  });

  it("uses only the in-force revision of a revised rule", () => {
    const old = resident("GOV-FRM-001", "old wording", { end: closed });
    const cur = resident("GOV-FRM-001", "new wording", { start: closed });
    const out = renderResidentBlock(set([old, cur])) as string;
    expect(out).to.include("new wording").and.not.include("old wording");
  });

  it("allows exactly the cap", () => {
    const rows = Array.from({ length: RESIDENT_CAP }, (_, i) => resident(`GOV-FRM-${String(i + 1).padStart(3, "0")}`));
    expect(RESIDENT_CAP).to.equal(40);
    expect(renderResidentBlock(set(rows))).to.be.a("string");
  });

  it("over the cap FAILS the build, naming the rows — it never truncates", () => {
    const fw = Array.from({ length: 30 }, (_, i) => resident(`GOV-FRM-${String(i + 1).padStart(3, "0")}`));
    const org = Array.from({ length: 11 }, (_, i) => resident(`GOV-SVM-${String(i + 1).padStart(3, "0")}`));
    const out = renderResidentBlock(set(fw, org));
    expect(out).to.have.property("error");
    const f = out as { error: string; ids: readonly string[] };
    expect(f.ids).to.have.length(41);
    expect(f.error).to.include("41").and.include(String(RESIDENT_CAP)).and.include("GOV-SVM-011").and.include("GOV-FRM-001");
    expect(f.error).to.match(/merge|shorten/);
  });

  it("refuses a cue that is not exactly one line", () => {
    const out = renderResidentBlock(set([resident("GOV-FRM-001", "two\nlines"), resident("GOV-FRM-002", "  ")]));
    expect(out).to.have.property("error");
    expect((out as { ids: string[] }).ids).to.deep.equal(["GOV-FRM-001", "GOV-FRM-002"]);
  });

  it("refuses to render an EMPTY block — a harness with no rules looks governed and governs nothing", () => {
    expect(renderResidentBlock(set([row("GOV-FRM-001")]))).to.have.property("error");
  });
});

const bind = (resource: string, event: string, w?: Record<string, unknown>): CheckBinding =>
  ({ on: { resource, event }, action: "gov-builtin/x", on_miss: "fail", ...(w ? { with: w } : {}) });
const onDemand = (id: string, checks: CheckBinding[], over: Partial<RuleRow> = {}): RuleRow =>
  row(id, { level: "C02", cue: { tier: "on-demand", text: `od ${id}` }, checks, ...over });

describe("cues — on-demand tier", () => {
  const pr = { resource: "vcs.code-repo", event: "pull_request" };

  it("returns the cues whose rule has a check bound to that resource and event", () => {
    const s = set(
      [onDemand("GOV-FRM-005", [bind("vcs.code-repo", "pull_request")]), onDemand("GOV-FRM-006", [bind("gov.verb", "close")])],
      [onDemand("GOV-SVM-001", [bind("vcs.code-repo", "push"), bind("vcs.code-repo", "pull_request")])],
    );
    expect(onDemandCues(s, pr).map((c) => c.id)).to.deep.equal(["GOV-FRM-005", "GOV-SVM-001"]);
    expect(onDemandCues(s, { resource: "gov.verb", event: "close" })[0]).to.deep.equal({ id: "GOV-FRM-006", level: "C02", text: "od GOV-FRM-006" });
  });

  it("orders framework first then org by id number, one cue per rule however many checks match", () => {
    const s = set(
      [onDemand("GOV-FRM-020", [bind("vcs.code-repo", "pull_request")]), onDemand("GOV-FRM-003", [bind("vcs.code-repo", "pull_request"), bind("vcs.code-repo", "pull_request")])],
      [onDemand("GOV-SVM-002", [bind("vcs.code-repo", "pull_request")])],
    );
    expect(onDemandCues(s, pr).map((c) => c.id)).to.deep.equal(["GOV-FRM-003", "GOV-FRM-020", "GOV-SVM-002"]);
  });

  it("filters file-glob bindings (with.paths / with.when) by the changed paths", () => {
    const s = set([
      onDemand("GOV-FRM-001", [bind("vcs.code-repo", "pull_request", { paths: ["**/package.json", "**/go.mod"] })]),
      onDemand("GOV-FRM-002", [bind("vcs.code-repo", "pull_request", { when: "src/**/*.ts" })]),
      onDemand("GOV-FRM-003", [bind("vcs.code-repo", "pull_request")]),
    ]);
    const ids = (paths?: string[]) => onDemandCues(s, { ...pr, paths }).map((c) => c.id);
    expect(ids(["web/package.json"])).to.deep.equal(["GOV-FRM-001", "GOV-FRM-003"]);
    expect(ids(["src/a.ts"])).to.deep.equal(["GOV-FRM-002", "GOV-FRM-003"]);
    expect(ids(["README.md"])).to.deep.equal(["GOV-FRM-003"]);
    expect(ids([])).to.deep.equal(["GOV-FRM-003"]);
    // Paths not known yet: every bound cue is shown — an extra cue costs a line, a missing one costs the rule.
    expect(ids(undefined)).to.deep.equal(["GOV-FRM-001", "GOV-FRM-002", "GOV-FRM-003"]);
  });

  it("an empty glob list matches nothing, never everything", () => {
    const s = set([onDemand("GOV-FRM-001", [bind("vcs.code-repo", "pull_request", { paths: [] })])]);
    expect(onDemandCues(s, { ...pr, paths: ["x"] })).to.deep.equal([]);
  });

  it("never returns retired rows, resident cues, cue-less rows, or rules no agent is bound by", () => {
    const b = [bind("vcs.code-repo", "pull_request")];
    const s = set([
      onDemand("GOV-FRM-001", b, { end: closed }),
      row("GOV-FRM-002", { cue: { tier: "resident", text: "r" }, checks: b }),
      row("GOV-FRM-003", { checks: b }),
      onDemand("GOV-FRM-004", b, { actor: ["human"] }),
      onDemand("GOV-FRM-005", b, { actor: ["agent"] }),
    ]);
    expect(onDemandCues(s, pr).map((c) => c.id)).to.deep.equal(["GOV-FRM-005"]);
  });
});

describe("cues — the human's gate message", () => {
  const r = row("GOV-SVM-012", { level: "C02", cue: { tier: "on-demand", text: "AGENT-ONLY CUE TEXT" } });

  it("quotes the GOV id, level and expectation, then the findings", () => {
    const msg = humanGateMessage(r, { verdict: "fail", findings: ["web/package.json adds left-pad", "go.mod adds x"] });
    expect(msg).to.equal([
      "GOV-SVM-012 · C02 — failed",
      "Expectation: Everyone MUST do the thing GOV-SVM-012 asks.",
      "Source: policies/org-policy.md §3.1",
      "Findings:",
      "  - web/package.json adds left-pad",
      "  - go.mod adds x",
    ].join("\n"));
  });

  it("gives a human no cue", () => {
    expect(humanGateMessage(r, { verdict: "fail", findings: [] })).to.not.include("AGENT-ONLY CUE TEXT");
  });

  it("says when there are no findings, and never reads cannot-tell as a pass", () => {
    const msg = humanGateMessage(r, { verdict: "cannot-tell", findings: [] });
    expect(msg.split("\n")[0]).to.equal("GOV-SVM-012 · C02 — could not tell");
    expect(msg).to.include("(none reported)");
  });

  it("is byte-stable and keeps findings in the order given", () => {
    const v = { verdict: "fail" as const, findings: ["b", "a"] };
    expect(humanGateMessage(r, v)).to.equal(humanGateMessage(r, v));
    expect(humanGateMessage(r, v).indexOf("  - b")).to.be.lessThan(humanGateMessage(r, v).indexOf("  - a"));
  });
});

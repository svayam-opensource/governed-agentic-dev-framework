// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
//
// W5 — THE POLICY PULL REQUEST GATE AND ITS WRITERS (rule-model-design.md Q5, Q6, Q16; P1 "Org version").
//
// GOV-FRM-467: a change to the organization's policy carries its rules, version, snapshot and changelog. Every
// case here is a pair of in-memory trees (base, head); the "good" head is built by the same writers propose will
// call, so a test that the gate passes it is also a test that the writers produce what the gate wants.
import { expect } from "chai";
import yaml from "js-yaml";
import { judgePolicyPr, planPolicyPr, changelogEntry, nextVersion, type GateCheck } from "../../../src/rules/policy-pr/gate.js";
import { policyPrWriter, renderChangelogEntry, type ChangelogEntry } from "../../../src/rules/policy-pr/write.js";
import { memTree, treeAsGit, type TreeReader } from "../../../src/rules/policy-pr/tree.js";
import { sectionShas } from "../../../src/rules/checks/sections.js";
import { parseRuleStore, type RuleRow } from "../../../src/rules/model/rule-row.js";
import { applyVerdicts } from "../../../src/rules/model/revise.js";
import { createIdIssuer } from "../../../src/rules/model/store-io.js";
import { runBuiltin } from "../../../src/rules/checks/builtin.js";
import { createCheckRunner } from "../../../src/rules/checks/runner.js";
import type { RuleSet } from "../../../src/rules/model/contracts.js";

const DOC = "policies/org-policy.md";
const TODAY = "2026-10-06";
const PR = 91;

const POLICY = [
  "# Org policy", "",
  "## 3 Technology", "",
  "### 3.1 Approved", "", "Everyone uses only approved technologies.", "",
  "### 3.2 Secrets", "", "Nobody commits a secret.", "",
].join("\n");
const sha = (text: string, section: string): string => sectionShas(text).get(section)!;

const row = (id: string, section: string, text: string, over: Partial<RuleRow> = {}): RuleRow => ({
  id,
  source: { doc: DOC, section, sha: sha(text, section) },
  expectation: `Everyone obeys ${section}.`,
  actor: ["everyone"],
  level: "C02",
  start: { version: "1.4.0", date: "2026-10-01", pr: 80 },
  end: null,
  ...over,
});
const dump = (rows: readonly RuleRow[]): string => yaml.dump(JSON.parse(JSON.stringify(rows)), { lineWidth: -1 });

const BASE_ROWS: RuleRow[] = [
  row("GOV-SVM-001", "3.1", POLICY),
  row("GOV-SVM-002", "3.2", POLICY),
  // retired before this change
  row("GOV-SVM-003", "3.2", POLICY, { start: { version: "1.0.0", date: "2026-01-01", pr: 2 }, end: { version: "1.4.0", date: "2026-10-01", pr: 80 } }),
];

function baseFiles(): Record<string, string> {
  return {
    "org-config.yaml": 'org_slug: "SVM"\n',
    "framework/rules/rules.yaml": "[]\n",
    "framework/rules/catalog.yaml": "resources: []\ntools: []\nactions: []\n",
    "policies/VERSION": "1.4.0\n",
    "policies/CHANGELOG.md": "# Policy changelog\n\n## 1.4.0 — 2026-10-01\n\nOlder entry.\n",
    [DOC]: POLICY,
    "policies/rules.yaml": dump(BASE_ROWS),
    "policies/actions/check-x/run.sh": "#!/bin/sh\nexit 0\n",
    "policies/version/1.3.0/org-policy.md": "# Org policy, as it was\n",
  };
}

const ENTRY = (version: string, rules: ChangelogEntry["rules"]): ChangelogEntry => ({
  version, date: TODAY, pr: PR, author: "alice", approver: "bob", rules,
  qa: [{ q: "Is §3.1 a C02 rule?", a: "Yes — an exception may be approved." }],
});

/** Base + a prose edit to §3.1 + the row for §3.1 revised — then the writers, as propose would run them. */
function goodPr(): { base: TreeReader; head: ReturnType<typeof memTree>; files: Record<string, string> } {
  const base = memTree(baseFiles());
  const files = baseFiles();
  const head = memTree(files);
  const prose = POLICY.replace("only approved technologies.", "only technologies on the approved list.");
  files[DOC] = prose;
  const applied = applyVerdicts(BASE_ROWS, [{ kind: "revise", id: "GOV-SVM-001", row: (({ id: _id, start: _s, end: _e, ...body }) => body)(row("x", "3.1", prose)) }],
    { version: "0.0.0", date: "1999-01-01" }, createIdIssuer(BASE_ROWS.map((r) => r.id)), "SVM");
  if (!applied.ok) throw new Error(applied.problems.join("; "));
  files["policies/rules.yaml"] = dump(applied.rows);
  const w = policyPrWriter({ base, head });
  const plan = planPolicyPr(base, head);
  if ("unreadable" in plan) throw new Error(plan.unreadable);
  const { version } = w.bumpVersion(plan.required === "none" ? "patch" : plan.required);
  w.writeSnapshot(plan.baseVersion);
  w.stampRows(version, TODAY, PR);
  w.writeChangelogEntry(ENTRY(version, [{ id: "GOV-SVM-001", change: "revised", expectation: "Everyone obeys 3.1." }]));
  return { base, head, files };
}

const judge = (base: TreeReader, head: TreeReader) => judgePolicyPr({ base, head, pr: PR, today: TODAY });
const checksOf = (j: { findings: readonly { check: GateCheck }[] }) => [...new Set(j.findings.map((x) => x.check))];

describe("GOV-FRM-467 policy PR gate — a change to the organization's policy carries its rules, version, snapshot and changelog", () => {
  it("the good PR, built by the writers, passes with no findings", () => {
    const { base, head } = goodPr();
    const j = judge(base, head);
    expect(j.findings).to.deep.equal([]);
    expect(j.verdict).to.equal("pass");
    expect(j.required).to.equal("minor");
    expect(j.headVersion).to.equal("1.5.0");
    expect(j.changes).to.deep.include({ revised: ["GOV-SVM-001"], added: [], retired: [] });
  });

  describe("(a) policies/ untouched", () => {
    it("passes and expects no bump, whatever else changed", () => {
      const files = baseFiles();
      files["README.md"] = "unrelated\n";
      const j = judge(memTree(baseFiles()), memTree(files));
      expect(j).to.deep.include({ verdict: "pass", touched: false, required: "none" });
    });
    it("a tree that cannot be listed is cannot-tell, never a pass", () => {
      const broken: TreeReader = { files: () => null, read: () => null };
      expect(judge(memTree(baseFiles()), broken).verdict).to.equal("cannot-tell");
    });
  });

  describe("(b) sha freshness", () => {
    it("fails a prose change whose rows still cite the old sha, naming the fix", () => {
      const files = baseFiles();
      files[DOC] = POLICY.replace("Nobody commits a secret.", "Nobody commits a secret or a key.");
      files["policies/VERSION"] = "1.4.1\n";
      const j = judge(memTree(baseFiles()), memTree(files));
      expect(j.findings.filter((x) => x.check === "sha").map((x) => x.message)).to.deep.equal([
        "GOV-SVM-002: policies/org-policy.md §3.2 changed; run gov rules propose",
      ]);
    });
    it("fails a row whose section no longer exists", () => {
      const files = baseFiles();
      files[DOC] = POLICY.replace(/### 3\.2[\s\S]*$/, "");
      files["policies/VERSION"] = "1.4.1\n";
      expect(judge(memTree(baseFiles()), memTree(files)).findings.map((x) => x.message)).to.include(
        "GOV-SVM-002: policies/org-policy.md §3.2 no longer exists; run gov rules propose");
    });
    it("a row cited at §3 stays fresh when only §3.1 changed — sections cut at the next numbered heading", () => {
      const files = baseFiles();
      files["policies/rules.yaml"] = dump([...BASE_ROWS, row("GOV-SVM-004", "3", POLICY)]);
      const base = memTree({ ...files });
      files[DOC] = POLICY.replace("only approved technologies.", "only listed technologies.");
      const msgs = judge(base, memTree(files)).findings.filter((x) => x.check === "sha").map((x) => x.message);
      expect(msgs).to.deep.equal(["GOV-SVM-001: policies/org-policy.md §3.1 changed; run gov rules propose"]);
    });
    it("passes when every row in force is fresh", () => {
      const { base, head } = goodPr();
      expect(checksOf(judge(base, head))).to.not.include("sha");
    });
  });

  describe("(c) both stores validate", () => {
    it("fails an org row with a bad level, and a binding the merged catalog lacks", () => {
      const { base, head, files } = goodPr();
      const rows = parseRuleStore(files["policies/rules.yaml"]!);
      const last = rows[rows.length - 1]!;
      rows[rows.length - 1] = { ...last, level: "C09" as never, checks: [{ on: { resource: "vcs.nowhere", event: "push" }, action: "gov-builtin/nothing", on_miss: "fail" }] };
      files["policies/rules.yaml"] = dump(rows);
      const msgs = judge(base, head).findings.filter((x) => x.check === "store").map((x) => x.message);
      expect(msgs.some((m) => /level "C09"/.test(m))).to.equal(true);
      expect(msgs.some((m) => /no resource "vcs.nowhere"/.test(m))).to.equal(true);
    });
    it("fails a framework store that does not validate", () => {
      const { base, head, files } = goodPr();
      files["framework/rules/rules.yaml"] = dump([{ ...BASE_ROWS[0]!, id: "GOV-SVM-900" }]);
      expect(judge(base, head).findings.some((x) => x.check === "store" && /framework store/.test(x.message))).to.equal(true);
    });
    it("an org-config with no slug is cannot-tell", () => {
      const { base, head, files } = goodPr();
      files["org-config.yaml"] = "org_name: x\n";
      expect(judge(base, head).verdict).to.equal("cannot-tell");
    });
  });

  describe("(d) append-only", () => {
    it("fails a removed base row", () => {
      const { base, head, files } = goodPr();
      files["policies/rules.yaml"] = dump(parseRuleStore(files["policies/rules.yaml"]!).filter((r) => r.id !== "GOV-SVM-003"));
      expect(judge(base, head).findings.map((x) => x.message)).to.include("GOV-SVM-003 (from 1.0.0) was removed — the store is append-only: close a row, never delete it");
    });
    it("fails a base row edited in place", () => {
      const { base, head, files } = goodPr();
      files["policies/rules.yaml"] = dump(parseRuleStore(files["policies/rules.yaml"]!).map((r) => (r.id === "GOV-SVM-002" ? { ...r, expectation: "Changed." } : r)));
      expect(judge(base, head).findings.map((x) => x.message)).to.include("GOV-SVM-002 was edited in place — revise it instead: close it and open a successor");
    });
    it("fails an edit to an already-closed row", () => {
      const { base, head, files } = goodPr();
      files["policies/rules.yaml"] = dump(parseRuleStore(files["policies/rules.yaml"]!).map((r) => (r.id === "GOV-SVM-003" ? { ...r, expectation: "Rewritten history." } : r)));
      expect(checksOf(judge(base, head))).to.include("append-only");
    });
    it("fails a row closed at a version other than the new one", () => {
      const { base, head, files } = goodPr();
      files["policies/rules.yaml"] = dump(parseRuleStore(files["policies/rules.yaml"]!).map((r) =>
        (r.id === "GOV-SVM-001" && r.end ? { ...r, end: { ...r.end, version: "1.4.5" } } : r)));
      expect(judge(base, head).findings.map((x) => x.message)).to.include("GOV-SVM-001 is closed at 1.4.5; it must close at the new version 1.5.0");
    });
    it("fails a retired id reused for a new rule", () => {
      const { base, head, files } = goodPr();
      const rows = parseRuleStore(files["policies/rules.yaml"]!);
      rows.push({ ...row("GOV-SVM-003", "3.2", POLICY), start: { version: "1.5.0", date: TODAY, pr: PR } });
      files["policies/rules.yaml"] = dump(rows);
      expect(judge(base, head).findings.map((x) => x.message)).to.include("GOV-SVM-003 was retired before this change; a retired id is never reused — gov issues a new one");
    });
  });

  describe("(d) a sha refresh — the ONE in-place edit (Q17: keep, intent unchanged, only the sha updated)", () => {
    /** Base + a reflowed-meaning prose edit to §3.2 whose rule is KEPT: its row's source.sha is refreshed in place. */
    function refreshPr(): { base: TreeReader; head: ReturnType<typeof memTree>; files: Record<string, string> } {
      const base = memTree(baseFiles());
      const files = baseFiles();
      const head = memTree(files);
      const prose = POLICY.replace("Nobody commits a secret.", "Nobody ever commits a secret.");
      files[DOC] = prose;
      const applied = applyVerdicts(BASE_ROWS, [{ kind: "keep", id: "GOV-SVM-002", sha: sha(prose, "3.2") }],
        { version: "0.0.0", date: "1999-01-01" }, createIdIssuer(BASE_ROWS.map((r) => r.id)), "SVM");
      if (!applied.ok) throw new Error(applied.problems.join("; "));
      files["policies/rules.yaml"] = dump(applied.rows);
      const w = policyPrWriter({ base, head });
      const plan = planPolicyPr(base, head);
      if ("unreadable" in plan) throw new Error(plan.unreadable);
      const { version } = w.bumpVersion(plan.required === "none" ? "patch" : plan.required);
      w.writeSnapshot(plan.baseVersion);
      w.stampRows(version, TODAY, PR);
      w.writeChangelogEntry(ENTRY(version, []));
      return { base, head, files };
    }

    it("passes, and is a PATCH: no rule was added, revised or retired", () => {
      const { base, head } = refreshPr();
      const j = judge(base, head);
      expect(j.findings).to.deep.equal([]);
      expect(j).to.deep.include({ verdict: "pass", required: "patch", headVersion: "1.4.1" });
      expect(j.changes).to.deep.include({ added: [], revised: [], retired: [], rowsChanged: false, refreshed: ["GOV-SVM-002"] });
    });

    it("the writers leave a refreshed row's start alone — it is the same row", () => {
      const { files } = refreshPr();
      const r = parseRuleStore(files["policies/rules.yaml"]!).find((x) => x.id === "GOV-SVM-002")!;
      expect(r.start).to.deep.equal(BASE_ROWS[1]!.start);
      expect(r.source.sha).to.not.equal(BASE_ROWS[1]!.source.sha);
    });

    it("a minor bump is refused for a refresh alone", () => {
      const { base, head, files } = refreshPr();
      files["policies/VERSION"] = "1.5.0\n";
      expect(checksOf(judge(base, head))).to.include("version");
    });

    for (const [what, edit] of [
      ["the sha and the expectation", (r: RuleRow) => ({ ...r, expectation: "Changed." })],
      ["the sha and the section", (r: RuleRow) => ({ ...r, source: { ...r.source, section: "3.1" } })],
      ["the sha and the start", (r: RuleRow) => ({ ...r, start: { ...r.start, pr: 81 } })],
      ["the sha and the level", (r: RuleRow) => ({ ...r, level: "C01" as const })],
    ] as const) {
      it(`refuses ${what} changed in place`, () => {
        const { base, head, files } = refreshPr();
        files["policies/rules.yaml"] = dump(parseRuleStore(files["policies/rules.yaml"]!).map((r) => (r.id === "GOV-SVM-002" ? edit(r) : r)));
        expect(checksOf(judge(base, head))).to.include("append-only");
      });
    }

    it("refuses a sha refresh on a CLOSED row — history is never rewritten", () => {
      const { base, head, files } = refreshPr();
      files["policies/rules.yaml"] = dump(parseRuleStore(files["policies/rules.yaml"]!).map((r) => (r.id === "GOV-SVM-003" ? { ...r, source: { ...r.source, sha: "0000000" } } : r)));
      expect(judge(base, head).findings.map((x) => x.message)).to.include("GOV-SVM-003 (from 1.0.0) is already closed and was edited — history is never rewritten");
    });
  });

  describe("(e) the version bump", () => {
    it("rows changed: minor or major pass, patch fails", () => {
      for (const [v, ok] of [["1.5.0", true], ["2.0.0", true], ["1.4.1", false], ["1.4.0", false], ["1.6.0", false]] as const) {
        const { base, head, files } = goodPr();
        files["policies/VERSION"] = `${v}\n`;
        const vf = judge(base, head).findings.filter((x) => x.check === "version");
        expect(vf.length === 0, `${v}: ${vf.map((x) => x.message).join("; ")}`).to.equal(ok);
      }
    });
    it("prose only: patch passes, minor fails with the reason", () => {
      const files = baseFiles();
      files["policies/onboarding.md"] = "# Onboarding\n\nWelcome.\n";
      files["policies/VERSION"] = "1.5.0\n";
      const j = judge(memTree(baseFiles()), memTree(files));
      expect(j.required).to.equal("patch");
      expect(j.findings.filter((x) => x.check === "version").map((x) => x.message)).to.deep.equal([
        "policies/VERSION is 1.5.0; only prose changed, so it must be 1.4.1 (or 2.0.0 if the organization chooses a major version)",
      ]);
      files["policies/VERSION"] = "1.4.1\n";
      expect(checksOf(judge(memTree(baseFiles()), memTree(files)))).to.not.include("version");
    });
    it("fails a bump when nothing in the policy changed", () => {
      const files = baseFiles();
      files["policies/VERSION"] = "1.4.1\n";
      const j = judge(memTree(baseFiles()), memTree(files));
      expect(j.required).to.equal("none");
      expect(j.findings.map((x) => x.message)).to.deep.equal(["policies/VERSION went from 1.4.0 to 1.4.1, but nothing in the policy changed — put it back to 1.4.0"]);
    });
    it("an org with no VERSION yet stands at 0.0.0 and its first rule change makes 0.1.0", () => {
      expect(nextVersion("0.0.0", "minor")).to.equal("0.1.0");
    });
  });

  describe("(f) the CHANGELOG entry", () => {
    it("fails when there is no entry for the new version", () => {
      const { base, head, files } = goodPr();
      files["policies/CHANGELOG.md"] = baseFiles()["policies/CHANGELOG.md"]!;
      expect(judge(base, head).findings.map((x) => x.message)).to.include("policies/CHANGELOG.md has no entry for 1.5.0");
    });
    it("fails an entry that misses an id, naming it and its change", () => {
      const { base, head, files } = goodPr();
      files["policies/CHANGELOG.md"] = files["policies/CHANGELOG.md"]!.replace(/GOV-SVM-001/g, "GOV-SVM-0001");
      expect(judge(base, head).findings.filter((x) => x.check === "changelog").map((x) => x.message)).to.deep.equal([
        "the policies/CHANGELOG.md entry for 1.5.0 does not name GOV-SVM-001 (revised)",
      ]);
    });
    it("an id named only in an OLDER entry does not count", () => {
      const { base, head, files } = goodPr();
      const text = files["policies/CHANGELOG.md"]!;
      files["policies/CHANGELOG.md"] = text.replace(/\| GOV-SVM-001 \|/, "| (see below) |").replace("Older entry.", "Older entry. GOV-SVM-001");
      expect(checksOf(judge(base, head))).to.include("changelog");
    });
    it("names added and retired ids too", () => {
      const { base, head, files } = goodPr();
      const rows = parseRuleStore(files["policies/rules.yaml"]!).map((r) => (r.id === "GOV-SVM-002" ? { ...r, end: { version: "1.5.0", date: TODAY, pr: PR } } : r));
      rows.push({ ...row("GOV-SVM-004", "3.2", POLICY), start: { version: "1.5.0", date: TODAY, pr: PR } });
      files["policies/rules.yaml"] = dump(rows);
      const msgs = judge(base, head).findings.filter((x) => x.check === "changelog").map((x) => x.message);
      expect(msgs).to.deep.equal([
        "the policies/CHANGELOG.md entry for 1.5.0 does not name GOV-SVM-004 (added)",
        "the policies/CHANGELOG.md entry for 1.5.0 does not name GOV-SVM-002 (retired)",
      ]);
    });
  });

  describe("(g) the snapshot of the previous version", () => {
    it("fails when policies/version/<prev>/ is missing", () => {
      const { base, head, files } = goodPr();
      for (const k of Object.keys(files)) if (k.startsWith("policies/version/1.4.0/")) delete files[k];
      expect(judge(base, head).findings.map((x) => x.message)).to.include(
        "no snapshot of 1.4.0: policies/version/1.4.0/ must hold the base's policies/ — run gov rules propose");
    });
    it("fails a snapshot that differs from the base by one byte, lacks a file, or has an extra one", () => {
      const { base, head, files } = goodPr();
      files["policies/version/1.4.0/org-policy.md"] += " ";
      delete files["policies/version/1.4.0/VERSION"];
      files["policies/version/1.4.0/extra.md"] = "x";
      expect(judge(base, head).findings.filter((x) => x.check === "snapshot").map((x) => x.message)).to.deep.equal([
        "policies/version/1.4.0/VERSION is missing from the snapshot of 1.4.0",
        "policies/version/1.4.0/org-policy.md differs from the base's policies/org-policy.md",
        "policies/version/1.4.0/extra.md is in the snapshot of 1.4.0 but not in the base's policies/",
      ]);
    });
    it("a snapshot excludes version/ and actions/", () => {
      const { files } = goodPr();
      const snap = Object.keys(files).filter((k) => k.startsWith("policies/version/1.4.0/")).sort();
      expect(snap).to.deep.equal([
        "policies/version/1.4.0/CHANGELOG.md", "policies/version/1.4.0/VERSION",
        "policies/version/1.4.0/org-policy.md", "policies/version/1.4.0/rules.yaml",
      ]);
    });
  });

  describe("(h) frozen snapshots", () => {
    it("fails an edit to a frozen file", () => {
      const { base, head, files } = goodPr();
      files["policies/version/1.3.0/org-policy.md"] = "rewritten";
      expect(judge(base, head).findings.map((x) => x.message)).to.include("policies/version/1.3.0/org-policy.md was edited — a snapshot is frozen");
    });
    it("fails a deleted frozen file, even when nothing else changed", () => {
      const files = baseFiles();
      delete files["policies/version/1.3.0/org-policy.md"];
      const j = judge(memTree(baseFiles()), memTree(files));
      expect(j.required).to.equal("none");
      expect(j.findings.map((x) => x.message)).to.deep.equal(["policies/version/1.3.0/org-policy.md was deleted — a snapshot is frozen"]);
    });
    it("fails a file added to a frozen snapshot, and a snapshot of a version this change does not freeze", () => {
      const { base, head, files } = goodPr();
      files["policies/version/1.3.0/new.md"] = "x";
      files["policies/version/9.9.9/a.md"] = "x";
      expect(judge(base, head).findings.filter((x) => x.check === "snapshot-immutable").map((x) => x.message)).to.deep.equal([
        "policies/version/1.3.0/new.md was added to the frozen snapshot of 1.3.0",
        "policies/version/9.9.9/ is a new snapshot, but this change freezes only 1.4.0",
      ]);
    });
  });

  describe("(i) stamps", () => {
    it("fails a new row stamped with another version, date or PR", () => {
      const { base, head, files } = goodPr();
      files["policies/rules.yaml"] = dump(parseRuleStore(files["policies/rules.yaml"]!).map((r, i, all) =>
        (i === all.length - 1 ? { ...r, start: { version: "1.5.0", date: "2026-10-05", pr: 90 } } : r)));
      expect(judge(base, head).findings.filter((x) => x.check === "stamp").map((x) => x.message)).to.deep.equal([
        "GOV-SVM-001 starts at 1.5.0 · 2026-10-05 · #90; a row this change opens starts at 1.5.0 · 2026-10-06 · #91",
      ]);
    });
    it("fails a closed row whose end lacks the PR", () => {
      const { base, head, files } = goodPr();
      files["policies/rules.yaml"] = dump(parseRuleStore(files["policies/rules.yaml"]!).map((r) =>
        (r.id === "GOV-SVM-001" && r.end ? { ...r, end: { version: "1.5.0", date: TODAY } } : r)));
      expect(judge(base, head).findings.filter((x) => x.check === "stamp").map((x) => x.message)).to.deep.equal([
        "GOV-SVM-001 ends at 1.5.0 · 2026-10-06 · #?; a row this change closes ends at 1.5.0 · 2026-10-06 · #91",
      ]);
    });
  });
});

describe("policy PR writers — each idempotent, each skipping work already done", () => {
  const fresh = () => {
    const files = baseFiles();
    files[DOC] = POLICY.replace("Everyone uses", "Everyone always uses");
    return { base: memTree(baseFiles()), files, head: memTree(files) };
  };

  it("bumpVersion bumps from the BASE version, once", () => {
    const { base, head, files } = fresh();
    const w = policyPrWriter({ base, head });
    expect(w.bumpVersion("minor")).to.deep.include({ wrote: true, version: "1.5.0" });
    expect(files["policies/VERSION"]).to.equal("1.5.0\n");
    expect(w.bumpVersion("minor")).to.deep.include({ wrote: false, version: "1.5.0" });
    expect(w.bumpVersion("patch"), "a patch is already covered by a minor").to.deep.include({ wrote: false, version: "1.5.0" });
    expect(w.bumpVersion("major")).to.deep.include({ wrote: true, version: "2.0.0" });
  });

  it("writeSnapshot copies base policies/ minus version/ and actions/, and never overwrites a snapshot", () => {
    const { base, head, files } = fresh();
    const w = policyPrWriter({ base, head });
    expect(w.writeSnapshot("1.4.0").wrote).to.equal(true);
    expect(files["policies/version/1.4.0/org-policy.md"]).to.equal(POLICY, "the BASE's text, not the head's");
    expect(Object.keys(files).filter((k) => k.startsWith("policies/version/1.4.0/actions") || k.startsWith("policies/version/1.4.0/version"))).to.deep.equal([]);
    files["policies/version/1.4.0/org-policy.md"] = "hand-edited";
    expect(w.writeSnapshot("1.4.0").wrote).to.equal(false);
    expect(files["policies/version/1.4.0/org-policy.md"]).to.equal("hand-edited");
  });

  it("writeChangelogEntry puts the newest entry first, and writes it once", () => {
    const { base, head, files } = fresh();
    const w = policyPrWriter({ base, head });
    const e = ENTRY("1.5.0", [{ id: "GOV-SVM-001", change: "revised", expectation: "Everyone uses only | listed tech." }]);
    expect(w.writeChangelogEntry(e).wrote).to.equal(true);
    const once = files["policies/CHANGELOG.md"]!;
    expect(once.indexOf("## 1.5.0")).to.be.lessThan(once.indexOf("## 1.4.0"));
    expect(once.startsWith("# Policy changelog\n")).to.equal(true);
    expect(w.writeChangelogEntry(e).wrote).to.equal(false);
    expect(files["policies/CHANGELOG.md"]).to.equal(once);
    expect(changelogEntry(once, "1.5.0")).to.contain("GOV-SVM-001");
  });

  it("writeChangelogEntry creates the file when there is none", () => {
    const { base, head, files } = fresh();
    delete files["policies/CHANGELOG.md"];
    policyPrWriter({ base, head }).writeChangelogEntry(ENTRY("1.4.1", []));
    expect(files["policies/CHANGELOG.md"]!.startsWith("# Policy changelog\n")).to.equal(true);
    expect(changelogEntry(files["policies/CHANGELOG.md"]!, "1.4.1")).to.not.equal(null);
  });

  it("the entry is human-readable: version, date, PR, author, approver, a rule table and the interview", () => {
    expect(renderChangelogEntry({ ...ENTRY("1.5.0", [{ id: "GOV-SVM-001", change: "revised", expectation: "A | B" }]), approver: null })).to.equal([
      "## 1.5.0 — 2026-10-06",
      "",
      "| Pull request | Author | Approver |",
      "|---|---|---|",
      "| #91 | @alice | _pending_ |",
      "",
      "| Rule | Change | Expectation |",
      "|---|---|---|",
      "| GOV-SVM-001 | revised | A \\| B |",
      "",
      "**Interview**",
      "",
      "- **Q:** Is §3.1 a C02 rule?",
      "  **A:** Yes — an exception may be approved.",
      "",
    ].join("\n"));
    expect(renderChangelogEntry({ ...ENTRY("1.4.1", []), qa: [] })).to.contain("_No rule changed — prose only._");
  });

  it("stampRows stamps rows this change opened or closed, and nothing else; a second run writes nothing", () => {
    const { base, head, files } = fresh();
    const prose = files[DOC]!;
    const applied = applyVerdicts(BASE_ROWS, [
      { kind: "retire", id: "GOV-SVM-002" },
      { kind: "add", row: { source: { doc: DOC, section: "3.1", sha: sha(prose, "3.1") }, expectation: "Everyone always obeys 3.1.", actor: ["everyone"], level: "C02" } },
    ], { version: "0.0.0", date: "1999-01-01" }, createIdIssuer(BASE_ROWS.map((r) => r.id)), "SVM");
    if (!applied.ok) throw new Error("apply");
    files["policies/rules.yaml"] = "# org rules — machine-written\n" + dump(applied.rows);
    const w = policyPrWriter({ base, head });
    expect(w.stampRows("1.5.0", TODAY, PR).wrote).to.equal(true);
    const text = files["policies/rules.yaml"]!;
    expect(text.startsWith("# org rules — machine-written\n"), "the header comment survives").to.equal(true);
    const rows = parseRuleStore(text);
    const at = { version: "1.5.0", date: TODAY, pr: PR };
    expect(rows.find((r) => r.id === "GOV-SVM-002")!.end).to.deep.equal(at);
    expect(rows.find((r) => r.id === "GOV-SVM-004")!.start).to.deep.equal(at);
    expect(rows.find((r) => r.id === "GOV-SVM-001")).to.deep.equal(BASE_ROWS[0]);
    expect(rows.find((r) => r.id === "GOV-SVM-003")).to.deep.equal(BASE_ROWS[2]);
    expect(w.stampRows("1.5.0", TODAY, PR).wrote).to.equal(false);
    expect(files["policies/rules.yaml"]).to.equal(text);
  });

  it("stampRows with no rule store writes nothing", () => {
    const { base, head, files } = fresh();
    delete files["policies/rules.yaml"];
    expect(policyPrWriter({ base, head }).stampRows("1.5.0", TODAY, PR).wrote).to.equal(false);
    expect(files["policies/rules.yaml"]).to.equal(undefined);
  });

  it("the whole sequence run twice leaves the tree as the first run did", () => {
    const { base, head, files } = goodPr();
    const before = JSON.stringify(files);
    const w = policyPrWriter({ base, head });
    w.bumpVersion("minor"); w.writeSnapshot("1.4.0"); w.stampRows("1.5.0", TODAY, PR);
    w.writeChangelogEntry(ENTRY("1.5.0", [{ id: "GOV-SVM-001", change: "revised", expectation: "Everyone obeys 3.1." }]));
    expect(JSON.stringify(files)).to.equal(before);
  });
});

describe("gov-builtin/policy-pr-gate — the dispatch", () => {
  const ctx = { resource: "vcs.gov-repo", event: "pull_request", payload: {} };
  const run = (policyPr?: Parameters<typeof runBuiltin>[0]["policyPr"]) =>
    runBuiltin({ ruleId: "GOV-FRM-467", action: "gov-builtin/policy-pr-gate", params: {}, ctx, readDefault: () => null, policyPr });

  it("with no trees given it is cannot-tell", () => {
    expect(run().verdict).to.equal("cannot-tell");
  });
  it("a good PR passes; a broken one is a miss with the gate's findings", () => {
    const { base, head, files } = goodPr();
    expect(run({ base, head, pr: PR, today: TODAY }).verdict).to.equal("pass");
    files["policies/VERSION"] = "1.4.1\n";
    const out = run({ base, head, pr: PR, today: TODAY });
    expect(out.verdict).to.equal("miss");
    expect(out.findings.some((x) => x.includes("GOV-FRM-467 [gov-builtin/policy-pr-gate]: policies/VERSION is 1.4.1"))).to.equal(true);
  });
  it("treeAsGit answers ls-tree and show over a tree", () => {
    const g = treeAsGit(memTree({ "a/b.md": "x", "c.md": "y" }));
    expect(g("", ["ls-tree", "-r", "--name-only", "HEAD", "--", "a", "c.md"])).to.equal("a/b.md\nc.md");
    expect(g("", ["show", "HEAD:a/b.md"])).to.equal("x");
    expect(g("", ["rev-parse"])).to.equal(null);
  });
});

describe("gov-builtin/policy-pr-gate — through the check runner", () => {
  const rule: RuleRow = {
    id: "GOV-FRM-467", source: { doc: "framework/docs/specs/framework-specification.md", section: "9.2", sha: "x" },
    expectation: "A change to the organization's policy carries its rules, version, snapshot and changelog.", actor: ["gov-client"], level: "C01",
    checks: [{ on: { resource: "vcs.gov-repo", event: "pull_request" }, action: "gov-builtin/policy-pr-gate", on_miss: "fail" }],
    start: { version: "1.2.3", date: "2026-10-06" }, end: null,
  };
  const rules: RuleSet = {
    framework: [rule], org: [], orgScope: "SVM", orgVersion: "1.4.0",
    catalog: { resources: [{ id: "vcs.gov-repo", renderer: "github-actions", events: [{ name: "pull_request", mode: "gate" }] }], tools: [{ id: "gov-builtin" }], actions: [{ id: "gov-builtin/policy-pr-gate", tool: "gov-builtin" }] },
  };
  const ctx = { resource: "vcs.gov-repo", event: "pull_request", payload: {} };

  it("the runner hands its policyPr to the action: given → judged; absent → cannot-tell", () => {
    const { base, head } = goodPr();
    expect(createCheckRunner({ rules, readDefault: () => null, policyPr: { base, head, pr: PR, today: TODAY } }).run("GOV-FRM-467", ctx).verdict).to.equal("pass");
    expect(createCheckRunner({ rules, readDefault: () => null, policyPr: { base, head, pr: PR, today: "2026-10-07" } }).run("GOV-FRM-467", ctx).verdict).to.equal("fail");
    expect(createCheckRunner({ rules, readDefault: () => null }).run("GOV-FRM-467", ctx).verdict).to.equal("cannot-tell");
  });
});

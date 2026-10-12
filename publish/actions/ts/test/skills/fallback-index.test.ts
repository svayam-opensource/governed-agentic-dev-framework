// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
//
// L15 — THE FALLBACK INDEX (intent 03 spec §5, D6; ruling Q14). An agent with no skill loader gov has SEEN work
// still gets its skills: an index section in its harness file — "when a task matches X, read <path>" — pointing at
// the fallback copy under `.agents/skills/`. The index is rendered with the harness, by the same code, so render
// parity covers it; a harness file read only by agents with a verified native location carries no index.
import { expect } from "chai";
import { AGENT_CATALOG, harnessFileFor } from "../../src/cli/agent-catalog.js";
import {
  renderSkillIndex, needsSkillIndex, withSkillIndex, SKILL_INDEX_HEADING, SKILL_INDEX_MARK,
} from "../../src/skills/fallback-index.js";
import { FALLBACK_SKILLS_DIR, SKILL_TARGETS } from "../../src/skills/locations.js";
import { renderSkills } from "../../src/skills/render.js";
import { buildArtifacts, HARNESS_DIR } from "../../src/rules/rules-build.js";
import { HARNESS_TARGETS, PROTOCOL_MARKER, RESIDENT_PLACEHOLDER, renderAll } from "../../src/rules/harness-render.js";
import type { RuleRow } from "../../src/rules/model/rule-row.js";
import type { RuleSet } from "../../src/rules/model/contracts.js";

const SPEC = "framework/docs/specs/framework-specification.md";
const SPEC_TEXT = ["# Spec", "", "## 6 Agents", "", "### 6.5 Saying which model it runs", "", "Say it.", ""].join("\n");
const readDoc = (d: string): string | null => (d === SPEC ? SPEC_TEXT : null);
const row = (id: string, over: Partial<RuleRow> = {}): RuleRow => ({
  id, source: { doc: SPEC, section: "6.5", sha: "abc" }, expectation: `Do what ${id} asks.`, actor: ["agent"], level: "C03",
  start: { version: "1.0.0", date: "2026-10-01" }, end: null, ...over,
});
const resident = row("GOV-FRM-012", { level: "C01", cue: { tier: "resident", text: "resident cue" } });
const set = (rows: RuleRow[]): RuleSet => ({ framework: rows, org: [], orgScope: "SVM", orgVersion: "1.0.0", catalog: { resources: [], tools: [], actions: [] } });
const PROTOCOL = `# Agent protocol\n\n<!-- ${PROTOCOL_MARKER}: 3 -->\n\n${RESIDENT_PLACEHOLDER}\n\nAfter the block.\n`;

/** Which harness files an agent with no verified native skill location reads — derived from the catalog. */
const indexedPaths = (): Set<string> => new Set(AGENT_CATALOG
  .filter((a) => !a.skillsDir && harnessFileFor(a.id) !== null)
  .map((a) => harnessFileFor(a.id)!));

describe("fallback index — which harness files carry it (Q14)", () => {
  it("every harness file read by an agent without a verified skillsDir, and only those", () => {
    for (const t of HARNESS_TARGETS) expect(needsSkillIndex(t.path), t.path).to.equal(indexedPaths().has(t.path));
  });

  it("today: claude-code, cursor and gemini read skills natively; the six other harness files carry the index", () => {
    expect(HARNESS_TARGETS.filter((t) => !needsSkillIndex(t.path)).map((t) => t.path).sort())
      .to.deep.equal([".cursor/rules/agent.mdc", "CLAUDE.md", "GEMINI.md"]);
  });

  it("the fallback copies live where the index points, and that location is a skill target", () => {
    expect(FALLBACK_SKILLS_DIR).to.equal(".agents/skills");
    expect(SKILL_TARGETS.map((t) => t.dir)).to.include(FALLBACK_SKILLS_DIR);
  });
});

describe("fallback index — the section", () => {
  const skills = renderSkills(set([row("GOV-FRM-134")]), readDoc);

  it("one line per skill: when the task matches, read the fallback copy", () => {
    const index = renderSkillIndex(skills);
    expect(index).to.contain(SKILL_INDEX_HEADING);
    expect(index).to.contain(SKILL_INDEX_MARK);
    for (const s of skills) {
      expect(index).to.contain(`read \`${FALLBACK_SKILLS_DIR}/${s.name}/SKILL.md\``);
      expect(index).to.contain(`When ${s.when}`);
    }
  });

  it("no skills → no section at all", () => {
    expect(renderSkillIndex([])).to.equal("");
    expect(withSkillIndex("body\n", "")).to.equal("body\n");
  });

  it("is appended after the protocol, leaving every byte before it unchanged", () => {
    const body = "# P\n\ntext\n";
    const out = withSkillIndex(body, renderSkillIndex(skills));
    expect(out.startsWith(body)).to.equal(true);
    expect(out.endsWith("\n")).to.equal(true);
  });
});

describe("fallback index — rendered with the harness (buildArtifacts)", () => {
  const harness = (files: readonly { path: string; content: string }[]) =>
    new Map(files.filter((f) => HARNESS_TARGETS.some((t) => f.path === `${HARNESS_DIR}/${t.path}`)).map((f) => [f.path.slice(HARNESS_DIR.length + 1), f.content]));

  it("each of the nine files: the index where needed, else byte-identical to the plain render", () => {
    const built = buildArtifacts(PROTOCOL, set([resident, row("GOV-FRM-134")]), undefined, readDoc);
    const plain = renderAll(PROTOCOL, set([resident, row("GOV-FRM-134")]));
    if ("error" in built || "error" in plain) throw new Error("render failed");
    const got = harness(built.files);
    expect(got.size).to.equal(HARNESS_TARGETS.length);
    for (const t of HARNESS_TARGETS) {
      const base = plain.files.find((f) => f.path === t.path)!.content;
      if (needsSkillIndex(t.path)) {
        expect(got.get(t.path), t.path).to.contain(SKILL_INDEX_MARK);
        expect(got.get(t.path)!.startsWith(base.replace(/\n+$/, "")), `${t.path}: the protocol and resident block come first, unchanged`).to.equal(true);
      } else {
        expect(got.get(t.path), t.path).to.equal(base);
      }
    }
  });

  it("every path the index names is a file the render writes", () => {
    const built = buildArtifacts(PROTOCOL, set([resident, row("GOV-FRM-134")]), undefined, readDoc);
    if ("error" in built) throw new Error(built.error);
    const agentsMd = built.files.find((f) => f.path === `${HARNESS_DIR}/AGENTS.md`)!.content;
    const named = [...agentsMd.matchAll(/`(\.agents\/skills\/[^`]+\/SKILL\.md)`/g)].map((m) => m[1]!);
    expect(named.length).to.equal(built.skills.length);
    for (const p of named) expect(built.files.some((f) => f.path === `${HARNESS_DIR}/${p}`), p).to.equal(true);
  });

  it("with no skills, all nine files are exactly the plain render — no empty index", () => {
    const built = buildArtifacts(PROTOCOL, set([resident]));
    const plain = renderAll(PROTOCOL, set([resident]));
    if ("error" in built || "error" in plain) throw new Error("render failed");
    const got = harness(built.files);
    for (const f of plain.files) expect(got.get(f.path), f.path).to.equal(f.content);
  });
});

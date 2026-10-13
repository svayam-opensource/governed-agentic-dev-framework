// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
//
// L14 — SKILLS FROM RULE ROWS (intent 03 spec §5, D6, X12). One skill per source-document section that holds C02 or
// C03 rows binding an agent; written with the harness by `gov rules build`, `agent/render-harness.mjs` and the
// launch mirror; a skill whose section is gone or renamed is deleted — but only a skill gov generated.
import { expect } from "chai";
import * as path from "node:path";
import type { RuleRow } from "../../src/rules/model/rule-row.js";
import type { RuleSet } from "../../src/rules/model/contracts.js";
import type { CheckBinding } from "../../src/rules/model/catalog.js";
import type { Fs } from "../../src/lifecycle/fs-io.js";
import {
  renderSkills, skillFiles, staleSkillDirs, isGovSkill, isGovSkillPath, SKILL_TARGETS, SKILL_GENERATED, SKILL_MARK, SKILL_NAME_MAX,
} from "../../src/skills/render.js";
import { buildArtifacts, HARNESS_DIR } from "../../src/rules/rules-build.js";
import { PROTOCOL_MARKER, RESIDENT_PLACEHOLDER } from "../../src/rules/harness-render.js";
import { rules } from "../../src/cli/rules-verb.js";
import { ensureRootProtocol, HARNESS_SRC_DIR } from "../../src/lifecycle/root-protocol.js";
import { SHIPPED_CATALOG } from "../helpers/rule-store.js";
import { px } from "../helpers/paths.js";
import { sectionShas } from "../../src/rules/checks/sections.js";

const SPEC = "framework/docs/specs/framework-specification.md";
const POLICY = "policies/engineering-policy.md";
const SPEC_TEXT = [
  "# Framework specification", "",
  "## 6 Agents", "", "### 6.5 Saying which model it runs", "", "The agent says which model it runs.", "",
  "## 8 Knowledge", "", "### 8.3 Write it down as you decide it", "", "Write decisions down.", "",
].join("\n");
const POLICY_TEXT = [
  "# Engineering policy", "",
  "## 3 Dependencies", "", "### 3.1 Approved packages", "", "Only approved packages.", "",
  "## 4 Reviews", "", "Humans review.", "",
].join("\n");

const row = (id: string, over: Partial<RuleRow> = {}): RuleRow => ({
  id,
  source: { doc: SPEC, section: "6.5", sha: "abc1234" },
  expectation: `The agent does what ${id} asks.`,
  actor: ["agent"],
  level: "C03",
  start: { version: "1.2.3", date: "2026-10-06" },
  end: null,
  ...over,
});
const bind = (resource: string, event: string, w?: Record<string, unknown>): CheckBinding =>
  ({ on: { resource, event }, action: "gov-builtin/x", on_miss: "fail", ...(w ? { with: w } : {}) });
const set = (framework: RuleRow[], org: RuleRow[] = []): RuleSet => ({
  framework, org, orgScope: "SVM", orgVersion: "2.4.0", catalog: { resources: [], tools: [], actions: [] },
});
const docs: Record<string, string> = { [SPEC]: SPEC_TEXT, [POLICY]: POLICY_TEXT };
const readDoc = (d: string): string | null => docs[d] ?? null;

/** Front matter as key → raw value text. */
const frontMatter = (content: string): Record<string, string> => {
  const m = /^---\n([\s\S]*?)\n---\n/.exec(content);
  expect(m, "SKILL.md opens with front matter").to.not.equal(null);
  return Object.fromEntries(m![1]!.split("\n").map((l) => [l.slice(0, l.indexOf(":")), l.slice(l.indexOf(":") + 1).trim()]));
};

const resident = (id: string): RuleRow => row(id, { level: "C01", cue: { tier: "resident", text: `resident ${id}` } });
const SAMPLE = set(
  [
    row("GOV-FRM-134"),                                                                // C03, no cue → expectation
    row("GOV-FRM-120", { cue: { tier: "on-demand", text: "Name the model first." }, checks: [bind("gov.verb", "task")] }),
    row("GOV-FRM-414", { source: { doc: SPEC, section: "8.3", sha: "x" }, actor: ["everyone"] }),
    resident("GOV-FRM-012"),                                                           // resident C01 → never a skill
    row("GOV-FRM-150", { source: { doc: SPEC, section: "8.5", sha: "x" }, actor: ["human"] }),     // binds no agent
    row("GOV-FRM-160", { source: { doc: SPEC, section: "9.1", sha: "x" }, end: { version: "1.3.0", date: "2026-10-07" } }), // retired
  ],
  [
    row("GOV-SVM-002", {
      source: { doc: POLICY, section: "3.1", sha: "y" }, level: "C02",
      cue: { tier: "on-demand", text: "Check the approved list before adding a package." },
      checks: [bind("vcs.code-repo", "pull_request", { paths: ["**/package.json", "**/go.mod"] })],
      start: { version: "2.1.0", date: "2026-10-01" },
    }),
    row("GOV-SVM-001", { source: { doc: POLICY, section: "3.1", sha: "y" }, level: "C03", start: { version: "2.3.0", date: "2026-10-02" } }),
  ],
);

describe("skills — one per source-document section with C02/C03 agent rows (X12)", () => {
  it("renders exactly one skill per such section, and none for resident, human-only or retired rows", () => {
    const names = renderSkills(SAMPLE, readDoc).map((s) => s.name);
    expect(names).to.deep.equal([
      "gov-framework-specification-6-5-saying-which-model-it-runs",
      "gov-framework-specification-8-3-write-it-down-as-you-decide-it",
      "gov-engineering-policy-3-1-approved-packages",
    ]);
  });

  it("puts every row of a section in its one skill, in rule order — framework then org, each by id number", () => {
    const [s65, , s31] = renderSkills(SAMPLE, readDoc);
    expect(s65!.ids).to.deep.equal(["GOV-FRM-120", "GOV-FRM-134"]);
    expect(s31!.ids).to.deep.equal(["GOV-SVM-001", "GOV-SVM-002"]);
    const body = s65!.content.slice(s65!.content.indexOf(SKILL_MARK));
    expect(body.indexOf("Name the model first.")).to.be.lessThan(body.indexOf("The agent does what GOV-FRM-134 asks."));
  });

  it("is byte-stable whatever order the store holds the rows in", () => {
    const flipped = set([...SAMPLE.framework].reverse(), [...SAMPLE.org].reverse());
    expect(renderSkills(flipped, readDoc)).to.deep.equal(renderSkills(SAMPLE, readDoc));
  });
});

describe("skills — C03 says preferred, C02 says required", () => {
  it("marks each C03 rule preferred and each C02 rule required", () => {
    const s31 = renderSkills(SAMPLE, readDoc)[2]!.content;
    expect(s31).to.match(/GOV-SVM-001.*Preferred/);
    expect(s31).to.match(/GOV-SVM-002.*Required/);
  });

  it("an all-C03 section reads as preferred practice in its description, and never as required", () => {
    const s83 = renderSkills(SAMPLE, readDoc)[1]!.content;
    expect(frontMatter(s83).description).to.match(/preferred/i);
    expect(s83).to.not.match(/Required/);
  });
});

describe("skills — the name gov-<doc-slug>-<section-slug>", () => {
  it("slugs the document's base name and the section's number and title, lowercase and hyphenated", () => {
    const s = renderSkills(set([row("GOV-FRM-150", { source: { doc: SPEC, section: "8.5", sha: "x" } })]),
      () => "### 8.5 The project's compliance record\n\ntext\n")[0]!;
    expect(s.name).to.equal("gov-framework-specification-8-5-the-projects-compliance-record");
  });

  it("keeps a name within the agents' limit (64), cutting the title at a word, never ending on a hyphen", () => {
    const long = "### 6.5 " + "a very long section title that keeps on going well past any limit".repeat(2) + "\n";
    const s = renderSkills(set([row("GOV-FRM-134")]), () => long)[0]!;
    expect(s.name.length).to.be.at.most(SKILL_NAME_MAX);
    expect(s.name).to.match(/^gov-framework-specification-6-5-[a-z0-9-]*[a-z0-9]$/);
    expect(s.name).to.not.contain("--");
  });

  it("falls back to the section number when the document cannot be read", () => {
    expect(renderSkills(set([row("GOV-FRM-134")]), () => null)[0]!.name).to.equal("gov-framework-specification-6-5");
  });
});

describe("skills — front matter: name, description, gov-ids, policy-version", () => {
  it("carries exactly the four fields, the name matching the directory it is written to", () => {
    const s = renderSkills(SAMPLE, readDoc)[2]!;
    const fm = frontMatter(s.content);
    expect(Object.keys(fm)).to.deep.equal(["name", "description", "gov-ids", "policy-version"]);
    expect(fm.name).to.equal(s.name);
    expect(fm["gov-ids"]).to.equal("[GOV-SVM-001, GOV-SVM-002]");
    // The newest start among the section's rows — the version at which this text took its present form.
    expect(fm["policy-version"]).to.equal('"2.3.0"');
  });

  it("describes the section title plus a 'use when' taken from the rows' bindings (path globs, gov verbs)", () => {
    const [s65, , s31] = renderSkills(SAMPLE, readDoc);
    const d31 = JSON.parse(frontMatter(s31!.content).description!) as string;
    expect(d31).to.contain("Approved packages").and.contain("Use when");
    expect(d31).to.contain("**/package.json").and.contain("**/go.mod");
    const d65 = JSON.parse(frontMatter(s65!.content).description!) as string;
    expect(d65).to.contain("Saying which model it runs").and.contain("gov task");
  });

  it("a section whose rows bind nothing says 'use when' from what the rows expect, within the 1024-char limit", () => {
    const s83 = renderSkills(SAMPLE, readDoc)[1]!;
    const d = JSON.parse(frontMatter(s83.content).description!) as string;
    expect(d).to.contain("Use when").and.contain("GOV-FRM-414");
    const many = set(Array.from({ length: 40 }, (_, i) => row(`GOV-FRM-${700 + i}`, { expectation: "x".repeat(200) })));
    const big = JSON.parse(frontMatter(renderSkills(many, readDoc)[0]!.content).description!) as string;
    expect(big.length).to.be.at.most(1024);
  });
});

describe("skills — body: cue texts in rule order, a link to the source, and 'generated by gov — do not edit'", () => {
  it("links the source section and says it is generated", () => {
    const s = renderSkills(SAMPLE, readDoc)[0]!.content;
    expect(s).to.contain(`(${SPEC}#65-saying-which-model-it-runs)`);
    expect(s).to.contain(SKILL_GENERATED);
    expect(isGovSkill(s)).to.equal(true);
    expect(isGovSkill("---\nname: gov-mine\ndescription: hand written\n---\n\nmy own skill\n")).to.equal(false);
    expect(isGovSkill(null)).to.equal(false);
  });
});

describe("skills — the verified locations and the fallback (L14, L15)", () => {
  it("writes each skill ONCE to the shared .agents/skills plus .claude/skills for Claude — no Cursor copy (D14)", () => {
    expect(SKILL_TARGETS.map((t) => [t.dir, [...t.agents], t.fallback])).to.deep.equal([
      [".claude/skills", ["claude-code"], false], [".agents/skills", ["cursor", "gemini-code-assist"], true],
    ]);
    const files = skillFiles(renderSkills(SAMPLE, readDoc)).map((f) => f.path);
    expect(files).to.include(".claude/skills/gov-engineering-policy-3-1-approved-packages/SKILL.md");
    expect(files).to.include(".agents/skills/gov-engineering-policy-3-1-approved-packages/SKILL.md");
    expect(files.some((f) => f.startsWith(".cursor/"))).to.equal(false);
    expect(files).to.have.length(6);
  });

  it("a generated copy left in the retired .cursor/skills is stale and removed; a person's skill there stays (D14)", () => {
    const sk = renderSkills(SAMPLE, readDoc)[0]!;
    const fs = memFs({
      [`/r/.cursor/skills/${sk.name}/SKILL.md`]: sk.content,
      ["/r/.cursor/skills/gov-mine/SKILL.md"]: "---\nname: gov-mine\n---\nmine\n",
    });
    expect(staleSkillDirs(fs, "/r", [sk.name]).map(px)).to.deep.equal([`/r/.cursor/skills/${sk.name}`]);
    expect(isGovSkillPath(`.cursor/skills/${sk.name}/SKILL.md`)).to.equal(true);
  });
});

const PROTOCOL_BODY = `# Agent protocol\n\n<!-- ${PROTOCOL_MARKER}: 3 -->\n\n${RESIDENT_PLACEHOLDER}\n\nAfter the block.\n`;

describe("skills — the resident C01 block is unchanged", () => {
  it("the nine harness files keep their bytes with and without on-demand rows — the fallback index (L15) only appends", () => {
    const bare = buildArtifacts(PROTOCOL_BODY, set([resident("GOV-FRM-012")]));
    const full = buildArtifacts(PROTOCOL_BODY, set([...SAMPLE.framework], [...SAMPLE.org]), undefined, readDoc);
    if ("error" in bare || "error" in full) throw new Error("render failed");
    // The rule map lists every row, so it differs by design; the nine agent files must not, except that a file read
    // by an index-only agent ends with the skill index (Q14) after everything it had.
    const harness = (fs: readonly { path: string; content: string }[]) =>
      fs.filter((f) => !f.path.includes("/skills/") && !f.path.endsWith("rule-map.md"));
    const b = harness(bare.files), f = harness(full.files);
    expect(f.map((x) => x.path)).to.deep.equal(b.map((x) => x.path));
    for (const [i, x] of f.entries()) {
      const before = b[i]!.content.replace(/\n+$/, "");
      expect(x.content.startsWith(before), x.path).to.equal(true);
      expect(x.content.slice(before.length).includes("resident"), `${x.path}: nothing resident after the block`).to.equal(false);
    }
    expect(bare.files.some((f) => f.path.includes("/skills/"))).to.equal(false);
    expect(full.files.filter((f) => f.path.startsWith(`${HARNESS_DIR}/.claude/skills/`))).to.have.length(3);
  });
});

/** A memory Fs whose `rm` is recursive, like node's. */
function memFs(seed: Record<string, string>): Fs & { readonly files: Map<string, string> } {
  const files = new Map(Object.entries(seed).map(([k, v]) => [px(k), v]));
  return {
    files,
    pathExists: (p) => files.has(px(p)) || [...files.keys()].some((f) => f.startsWith(`${px(p)}/`)),
    readFile: (p) => files.get(px(p)) ?? null,
    writeFile: (p, c) => { files.set(px(p), c); },
    rm: (p) => { for (const f of [...files.keys()]) if (f === px(p) || f.startsWith(`${px(p)}/`)) files.delete(f); },
    mkdirp: () => {},
    readdir: (dir) => {
      const prefix = `${px(dir).replace(/\/+$/, "")}/`;
      return [...new Set([...files.keys()].filter((f) => f.startsWith(prefix)).map((f) => f.slice(prefix.length).split("/")[0]!))];
    },
  };
}

describe("skills — renamed section → new skill, old one deleted (gov's only, never the user's)", () => {
  it("staleSkillDirs names a generated skill no longer wanted, and leaves user skills — even gov-prefixed ones — alone", () => {
    const old = renderSkills(SAMPLE, readDoc)[0]!;
    const fs = memFs({
      [`/r/.claude/skills/${old.name}/SKILL.md`]: old.content,
      "/r/.claude/skills/my-skill/SKILL.md": "---\nname: my-skill\n---\n",
      "/r/.claude/skills/gov-handmade/SKILL.md": "---\nname: gov-handmade\ndescription: mine\n---\n",
    });
    expect(staleSkillDirs(fs, "/r", []).map(px)).to.deep.equal([`/r/.claude/skills/${old.name}`]);
    expect(staleSkillDirs(fs, "/r", [old.name])).to.deep.equal([]);
  });

  const HOME = "/gov";
  const rowYaml = (id: string, section: string, level: string, cue: string): string => `- id: ${id}
  source: { doc: ${SPEC}, section: "${section}", sha: "${sectionShas(SPEC_TEXT).get(section)}" }
  expectation: "The agent does ${id}."
  actor: [agent]
  level: ${level}
  cue: { tier: ${cue === "resident" ? "resident" : "on-demand"}, text: "cue ${id}" }
${cue === "resident" ? "" : "  checks:\n    - on: { resource: gov.verb, event: task }\n      action: gov-builtin/naming\n      on_miss: warn\n"}  start: { version: "1.2.3", date: "2026-10-06" }
  end: null
`;
  const workspace = (spec: string): Record<string, string> => ({
    [`${HOME}/org-config.yaml`]: "org_slug: SVM\n",
    [`${HOME}/framework/rules/rules.yaml`]: rowYaml("GOV-FRM-012", "6.5", "C01", "resident") + rowYaml("GOV-FRM-134", "6.5", "C03", "on-demand"),
    [`${HOME}/framework/rules/checks-catalog.yaml`]: SHIPPED_CATALOG,
    [`${HOME}/policies/rules.yaml`]: "[]\n",
    [`${HOME}/${SPEC}`]: spec,
    [`${HOME}/agent/session-protocol.md`]: PROTOCOL_BODY,
    [`${HOME}/agent/harness/.claude/skills/someone-elses/SKILL.md`]: "---\nname: someone-elses\n---\n",
  });
  const WT = { home: HOME, defaultBranch: "main", workingTree: true } as const;
  const OLD = "gov-framework-specification-6-5-saying-which-model-it-runs";
  const NEW = "gov-framework-specification-6-5-declaring-the-model";

  it("gov rules build writes the skills; renaming the section writes the new one and deletes the old, check agrees", () => {
    const fs = memFs(workspace(SPEC_TEXT));
    const built = rules({ fs }, WT, "build");
    expect(built.code, built.lines.join("\n")).to.equal(0);
    for (const t of SKILL_TARGETS) expect(fs.readFile(`${HOME}/agent/harness/${t.dir}/${OLD}/SKILL.md`), t.dir).to.contain("cue GOV-FRM-134");
    expect(rules({ fs }, WT, "check").code).to.equal(0);

    fs.writeFile(`${HOME}/${SPEC}`, SPEC_TEXT.replace("Saying which model it runs", "Declaring the model"));
    const check = rules({ fs }, WT, "check");
    expect(check.code).to.equal(1);
    expect(check.lines.join("\n")).to.contain(`${OLD}`);

    const again = rules({ fs }, WT, "build");
    expect(again.code, again.lines.join("\n")).to.equal(0);
    expect(again.lines.join("\n")).to.contain(`removed ${SKILL_TARGETS.length} stale skill`);
    for (const t of SKILL_TARGETS) {
      expect(fs.readFile(`${HOME}/agent/harness/${t.dir}/${NEW}/SKILL.md`), t.dir).to.contain("Declaring the model");
      expect(fs.readFile(`${HOME}/agent/harness/${t.dir}/${OLD}/SKILL.md`), t.dir).to.equal(null);
    }
    expect(fs.readFile(`${HOME}/agent/harness/.claude/skills/someone-elses/SKILL.md`), "a user's skill is never touched").to.not.equal(null);
  });
});

describe("skills — mirrored at launch to where the agent reads them", () => {
  const PROJECT = "/work/PRJ-9";
  const WS = "gov-ws";
  const API = `${PROJECT}/api`;
  const skill = renderSkills(SAMPLE, readDoc)[2]!;
  const dir = HARNESS_SRC_DIR.split(path.sep).join("/");

  it("copies every rendered skill into the project root and each code repo, and removes a stale generated one", () => {
    const stale = renderSkills(SAMPLE, readDoc)[0]!;
    const files: Record<string, string> = {
      [`${API}/.git`]: "gitdir: x",
      [`${PROJECT}/.claude/skills/${stale.name}/SKILL.md`]: stale.content,
      [`${API}/.cursor/skills/team-skill/SKILL.md`]: "---\nname: team-skill\n---\n",
    };
    for (const f of skillFiles([skill])) files[`${PROJECT}/${WS}/${dir}/${f.path}`] = f.content;
    const fs = memFs(files);
    const source = {
      defaultBranch: "main",
      git: (repo: string, args: readonly string[]): string | null => {
        if (args[0] === "rev-parse") return args[3] === "main^{commit}" ? "abc1234" : null;
        if (args[0] === "ls-tree") return skillFiles([skill]).map((f) => `${dir}/${f.path}`).join("\n");
        if (args[0] === "show") return fs.readFile(path.join(repo, args[1]!.slice("main:".length)));
        return null;
      },
    };
    const r = ensureRootProtocol(fs, PROJECT, WS, source);
    for (const at of [PROJECT, API]) {
      for (const t of SKILL_TARGETS) expect(fs.readFile(`${at}/${t.dir}/${skill.name}/SKILL.md`), `${at} ${t.dir}`).to.equal(skill.content);
    }
    expect(fs.readFile(`${PROJECT}/.claude/skills/${stale.name}/SKILL.md`), "stale generated skill removed").to.equal(null);
    expect(fs.readFile(`${API}/.cursor/skills/team-skill/SKILL.md`), "the team's own skill stays").to.not.equal(null);
    expect(r.skills).to.deep.equal([skill.name]);
    // Second launch: nothing changes, nothing is written.
    expect(ensureRootProtocol(fs, PROJECT, WS, source).written).to.equal(0);
  });
});

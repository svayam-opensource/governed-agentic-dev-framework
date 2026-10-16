// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
//
// L15 — LIFECYCLE STEP SKILLS (intent 03 spec §5, D6; ruling Q13). One skill per active lifecycle step — intent,
// spec, plan, build — built from that step's section of `policies/active/ai-sdlc-lifecycle.md` and the template its
// `Template:` line names, so any agent (autorun's included) writes the artifact the organization's way. No active
// lifecycle → no lifecycle skills.
import { expect } from "chai";
import * as nodeFs from "node:fs";
import * as path from "node:path";
import { renderLifecycleSkills, LIFECYCLE_SKILL_STEPS } from "../../src/skills/lifecycle.js";
import { skillFiles, staleSkillDirs, isGovSkill, SKILL_TARGETS, SKILL_DESCRIPTION_MAX } from "../../src/skills/render.js";
import { ARTIFACT_SECTIONS, LIFECYCLE_POLICY_PATH } from "../../src/intent/lifecycle-policy.js";
import { buildArtifacts, HARNESS_DIR } from "../../src/rules/rules-build.js";
import { PROTOCOL_MARKER, RESIDENT_PLACEHOLDER } from "../../src/rules/harness-render.js";
import type { RuleRow } from "../../src/rules/model/rule-row.js";
import type { RuleSet } from "../../src/rules/model/contracts.js";

const CONTENT = path.join(import.meta.dirname, "..", "..", "..", "..", "content");
/** Reads the shipped starter lifecycle and its templates, as an adopter's governance repo would hold them. */
const shipped = (rel: string): string | null => {
  const at = path.join(CONTENT, rel);
  return nodeFs.existsSync(at) ? nodeFs.readFileSync(at, "utf8") : null;
};

const frontMatter = (content: string): Record<string, string> => {
  const m = /^---\n([\s\S]*?)\n---\n/.exec(content);
  expect(m, "SKILL.md opens with front matter").to.not.equal(null);
  return Object.fromEntries(m![1]!.split("\n").map((l) => [l.slice(0, l.indexOf(":")), l.slice(l.indexOf(":") + 1).trim()]));
};

describe("lifecycle skills — one per active step: intent, spec, plan, build (Q13)", () => {
  it("names the four steps it serves, in lifecycle order", () => {
    expect([...LIFECYCLE_SKILL_STEPS]).to.deep.equal(["intent", "spec", "plan", "build"]);
  });

  it("renders gov-lifecycle-{intent,spec,plan,build} from the starter lifecycle, and none for deploy or run", () => {
    const skills = renderLifecycleSkills(shipped);
    expect(skills.map((s) => s.name)).to.deep.equal(["gov-lifecycle-intent", "gov-lifecycle-spec", "gov-lifecycle-plan", "gov-lifecycle-build"]);
  });

  it("no active lifecycle → no lifecycle skills", () => {
    expect(renderLifecycleSkills(() => null)).to.deep.equal([]);
    expect(renderLifecycleSkills((rel) => (rel === LIFECYCLE_POLICY_PATH ? null : shipped(rel)))).to.deep.equal([]);
  });

  it("only the steps the org's lifecycle has; a step gov cannot parse gives no skill", () => {
    const text = [
      "# Our lifecycle", "",
      "## Spec (phase: build)", "", "Template: `policies/reference/lifecycles/ai-sdlc/spec.md`", "", "We write specs carefully.", "",
      "## Plan", "", "Template: `policies/reference/lifecycles/ai-sdlc/plan.md`", "",   // no phase tag → unparseable
    ].join("\n");
    const skills = renderLifecycleSkills((rel) => (rel === LIFECYCLE_POLICY_PATH ? text : shipped(rel)));
    expect(skills.map((s) => s.name)).to.deep.equal(["gov-lifecycle-spec"]);
    expect(skills[0]!.content).to.contain("We write specs carefully.");
  });
});

describe("lifecycle skills — built from the step's section and its template", () => {
  const skills = renderLifecycleSkills(shipped);
  const byStep = (s: string) => skills.find((k) => k.name === `gov-lifecycle-${s}`)!;

  it("carries the step's own section text — the org's words, not gov's", () => {
    expect(byStep("intent").content).to.contain("The owner interview");
    expect(byStep("plan").content).to.contain("Approving\nthe plan approves its task issues.");
  });

  for (const step of ["intent", "spec", "plan", "build"] as const) {
    it(`${step}: lists every required section (§2.3), inlines the template, names where the artifact goes`, () => {
      const c = byStep(step).content;
      for (const h of ARTIFACT_SECTIONS[step]) expect(c, h).to.contain(`- ${h}`);
      const template = shipped(`policies/reference/lifecycles/ai-sdlc/${step}.md`)!;
      expect(c).to.contain(template.trimEnd());
      expect(c).to.contain(`projects/<PRJ>/intents/<NN-slug>/${step}.md`);
      expect(c).to.contain("**Status:** DRAFT");
    });
  }

  it("an edited step reaches the skill: change the policy, the skill follows", () => {
    const policy = shipped(LIFECYCLE_POLICY_PATH)!.replace("The spec says what will be true", "Our spec states what will hold");
    const s = renderLifecycleSkills((rel) => (rel === LIFECYCLE_POLICY_PATH ? policy : shipped(rel)));
    expect(s.find((k) => k.name === "gov-lifecycle-spec")!.content).to.contain("Our spec states what will hold");
  });

  it("a template that cannot be read: the skill still lists the required sections and says so", () => {
    const s = renderLifecycleSkills((rel) => (rel.includes("/reference/") ? null : shipped(rel)));
    const intent = s.find((k) => k.name === "gov-lifecycle-intent")!;
    for (const h of ARTIFACT_SECTIONS.intent) expect(intent.content).to.contain(`- ${h}`);
    expect(intent.content).to.match(/could not be read/);
  });
});

describe("lifecycle skills — front matter and the generated mark", () => {
  for (const s of renderLifecycleSkills(shipped)) {
    it(`${s.name}: name matches, description says when, source names the policy and template; gov's mark`, () => {
      const fm = frontMatter(s.content);
      expect(fm.name).to.equal(s.name);
      const description = JSON.parse(fm.description!) as string;
      expect(description).to.match(/Use when /);
      expect(description.length).to.be.at.most(SKILL_DESCRIPTION_MAX);
      expect(fm.source).to.equal(LIFECYCLE_POLICY_PATH);
      expect(fm.template).to.match(/^policies\/reference\/lifecycles\/ai-sdlc\/(intent|spec|plan|build)\.md$/);
      expect(isGovSkill(s.content)).to.equal(true);
      expect(s.when).to.match(/\S/);
    });
  }
});

describe("lifecycle skills — rendered with the harness, at every skill location, and removed when the lifecycle goes", () => {
  const PROTOCOL = `# Agent protocol\n\n<!-- ${PROTOCOL_MARKER}: 3 -->\n\n${RESIDENT_PLACEHOLDER}\n`;
  const resident: RuleRow = {
    id: "GOV-FRM-012", source: { doc: "framework/docs/specs/framework-specification.md", section: "6.5", sha: "abc" },
    expectation: "x", actor: ["agent"], level: "C01", cue: { tier: "resident", text: "resident" },
    start: { version: "1.0.0", date: "2026-10-01" }, end: null,
  };
  const set: RuleSet = { framework: [resident], org: [], orgScope: "SVM", orgVersion: "1.0.0", catalog: { resources: [], tools: [], actions: [] } };

  it("buildArtifacts writes each lifecycle skill at each location and lists it", () => {
    const built = buildArtifacts(PROTOCOL, set, undefined, shipped);
    if ("error" in built) throw new Error(built.error);
    for (const step of LIFECYCLE_SKILL_STEPS) {
      expect(built.skills).to.include(`gov-lifecycle-${step}`);
      for (const t of SKILL_TARGETS) {
        expect(built.files.some((f) => f.path === `${HARNESS_DIR}/${t.dir}/gov-lifecycle-${step}/SKILL.md`), `${t.dir} ${step}`).to.equal(true);
      }
    }
  });

  it("with no lifecycle, the generated lifecycle skills are stale and deleted", () => {
    const files = new Map(skillFiles(renderLifecycleSkills(shipped)).map((f) => [`/h/${f.path}`, f.content]));
    const fs = {
      // POSIX keys; gov asks with path.join paths (`\h\…` on Windows), as readFile below already allows for.
      readdir: (dir: string) => {
        const d = dir.split(path.sep).join("/");
        return [...new Set([...files.keys()].filter((f) => f.startsWith(`${d}/`)).map((f) => f.slice(d.length + 1).split("/")[0]!))];
      },
      readFile: (f: string) => files.get(f.split(path.sep).join("/")) ?? null,
    };
    const built = buildArtifacts(PROTOCOL, set, undefined, () => null);
    if ("error" in built) throw new Error(built.error);
    const gone = staleSkillDirs(fs, "/h", built.skills).map((d) => d.split(path.sep).join("/"));
    expect(gone).to.have.length(LIFECYCLE_SKILL_STEPS.length * SKILL_TARGETS.length);
    expect(gone.every((d) => /\/gov-lifecycle-(intent|spec|plan|build)$/.test(d))).to.equal(true);
  });
});

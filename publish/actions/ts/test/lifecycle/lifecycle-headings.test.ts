// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * X7 — gov reads the adopted lifecycle from its HEADINGS only (`## <n>. <Step> (phase: <build|deploy|run>)`) and
 * each step's `Template:` line. Policies carry no front matter, and gov never edits the prose; a section it cannot
 * parse is a `gov doctor` advisory, never a guess.
 */
import { expect } from "chai";
import * as fs from "node:fs";
import * as path from "node:path";
import { parseLifecycle, lifecycleDiagnostic, LIFECYCLE_POLICY_PATH } from "../../src/intent/lifecycle-policy.js";
import { doctor, type DoctorFacts } from "../../src/maintain/doctor.js";

const CONTENT = path.join(import.meta.dirname, "..", "..", "..", "..", "content");
const starter = fs.readFileSync(path.join(CONTENT, LIFECYCLE_POLICY_PATH), "utf8");

describe("lifecycle policy — X7 heading parse", () => {
  it("the shipped starter parses to six steps, each with its phase and its template", () => {
    const r = parseLifecycle(starter);
    expect(r.problems).to.deep.equal([]);
    expect(r.steps.map((s) => [s.step, s.phase])).to.deep.equal([
      ["intent", "build"], ["spec", "build"], ["plan", "build"], ["build", "build"], ["deploy", "deploy"], ["run", "run"],
    ]);
    for (const s of r.steps) expect(s.template).to.equal(`policies/reference/lifecycles/ai-sdlc/${s.step}.md`);
  });

  it("every template the starter names exists in content", () => {
    for (const s of parseLifecycle(starter).steps) expect(fs.existsSync(path.join(CONTENT, s.template!)), s.template!).to.equal(true);
  });

  it("an unnumbered heading parses the same as a numbered one", () => {
    const r = parseLifecycle("## Spec (phase: build)\n\nTemplate: `policies/reference/lifecycles/x/spec.md`\n");
    expect(r.problems).to.deep.equal([]);
    expect(r.steps[0]).to.include({ step: "spec", phase: "build", template: "policies/reference/lifecycles/x/spec.md" });
  });

  it("an unknown phase is a problem naming the heading — no step is guessed", () => {
    const r = parseLifecycle("## 3. Intent (phase: design)\n\nTemplate: `policies/reference/lifecycles/x/intent.md`\n");
    expect(r.steps).to.deep.equal([]);
    expect(r.problems.join("\n")).to.match(/Intent \(phase: design\)/).and.match(/build\|deploy\|run/);
  });

  it("a step heading without its phase tag is a problem", () => {
    const r = parseLifecycle("## 4. Spec\n\nTemplate: `policies/reference/lifecycles/x/spec.md`\n");
    expect(r.steps).to.deep.equal([]);
    expect(r.problems.join("\n")).to.match(/Spec/).and.match(/phase/);
  });

  it("a step without a Template line is a problem; a template outside policies/reference/ is a problem", () => {
    expect(parseLifecycle("## Plan (phase: build)\n\nNo template here.\n").problems.join("\n")).to.match(/Plan.*Template/);
    expect(parseLifecycle("## Plan (phase: build)\n\nTemplate: `policies/org-policy.md`\n").problems.join("\n")).to.match(/policies\/reference\//);
  });

  it("an unknown step name with a phase tag is a problem", () => {
    expect(parseLifecycle("## Celebrate (phase: run)\n\nTemplate: `policies/reference/lifecycles/x/c.md`\n").problems.join("\n")).to.match(/Celebrate/);
  });

  it("a heading inside a fenced code block is never a step", () => {
    const r = parseLifecycle("```\n## Spec (phase: nonsense)\n```\n");
    expect(r).to.deep.equal({ steps: [], problems: [] });
  });

  it("non-step sections (Roles, Gates, …) are ignored", () => {
    expect(parseLifecycle("## 1. Why\n\n## 2. Roles\n\n## 9. Gates\n")).to.deep.equal({ steps: [], problems: [] });
  });
});

describe("lifecycle policy — gov doctor advisory", () => {
  const base: DoctorFacts = { gitPresent: true, ghPresent: true, resolve: { ok: true, home: "/gov", org: "o", via: "active-org" }, activeOrg: "o", cliVersion: "1" };
  const row = (t: string | null | undefined) => doctor({ ...base, lifecycleText: t }).diagnostics.find((d) => d.name === "lifecycle");

  it("no row when the lifecycle was not read", () => { expect(row(undefined)).to.equal(undefined); });
  it("ok, saying lifecycle commands do nothing, when none is adopted", () => {
    expect(row(null)).to.include({ status: "ok" });
    expect(row(null)!.detail).to.match(/none adopted/);
  });
  it("ok with the step count for the shipped starter", () => {
    expect(row(starter)).to.include({ status: "ok" });
    expect(row(starter)!.detail).to.match(/6 steps/);
  });
  it("a broken heading is a WARNING (advisory), never a failure, and names the heading", () => {
    const broken = starter.replace("## 4. Spec (phase: build)", "## 4. Spec (phase: design)");
    const r = doctor({ ...base, lifecycleText: broken });
    const d = r.diagnostics.find((x) => x.name === "lifecycle")!;
    expect(d.status).to.equal("warn");
    expect(d.detail).to.match(/Spec \(phase: design\)/);
    expect(r.ok).to.equal(true);
    expect(lifecycleDiagnostic(broken)!.status).to.equal("warn");
  });
});

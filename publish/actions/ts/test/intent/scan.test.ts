// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/** Q1 — gov scans projects/<PRJ>/intents/<NN-slug>/ only; no adopted lifecycle → it says so and does nothing. */
import { expect } from "chai";
import { scanIntents, type TreeReader } from "../../src/intent/scan.js";
import { LIFECYCLE_POLICY_PATH } from "../../src/intent/lifecycle-policy.js";

const POLICY = "# AI-native software lifecycle\n\n## Intent (phase: build)\nTemplate: `policies/reference/lifecycles/ai-sdlc/intent.md`\n";
const art = (status: string, sections = ""): string => `# A\n\n${status}\n\n${sections}`;

function tree(files: Record<string, string>): TreeReader & { reads: string[] } {
  const reads: string[] = [];
  return {
    reads,
    async list(dir) {
      const pre = `${dir}/`;
      const names = new Set<string>();
      for (const p of Object.keys(files)) if (p.startsWith(pre)) names.add(p.slice(pre.length).split("/")[0]);
      return names.size ? [...names].sort() : null;
    },
    async read(p) { reads.push(p); return files[p] ?? null; },
  };
}

describe("intent scan (Q1)", () => {
  it("no lifecycle in policies/active/ → says so, reads nothing else", async () => {
    const t = tree({ "projects/PRJ-1-x/intents/01-a/intent.md": art("**Status:** DRAFT") });
    const r = await scanIntents(t, "PRJ-1-x");
    expect(r.active).to.equal(false);
    expect(!r.active && r.message).to.contain(LIFECYCLE_POLICY_PATH);
    expect(t.reads).to.deep.equal([LIFECYCLE_POLICY_PATH]);
  });

  it("reads intent/spec/plan/build and each Status", async () => {
    const t = tree({
      [LIFECYCLE_POLICY_PATH]: POLICY,
      "projects/PRJ-1-x/intents/01-first/intent.md": art("**Status: APPROVED by ada 2026-10-01 (https://github.com/a/b/pull/1)**"),
      "projects/PRJ-1-x/intents/01-first/spec.md": art("**Status:** DRAFT"),
      "projects/PRJ-1-x/intents/02-second-one/intent.md": art("no status here"),
    });
    const r = await scanIntents(t, "PRJ-1-x");
    if (!r.active) throw new Error("expected active");
    expect(r.intents.map((i) => i.id)).to.deep.equal(["01-first", "02-second-one"]);
    const first = r.intents[0];
    expect(first.number).to.equal(1);
    expect(first.slug).to.equal("first");
    expect(first.dir).to.equal("projects/PRJ-1-x/intents/01-first");
    expect(first.artifacts.intent?.status).to.deep.equal({ kind: "approved", text: "by ada 2026-10-01 (https://github.com/a/b/pull/1)" });
    expect(first.artifacts.spec?.status).to.deep.equal({ kind: "draft" });
    expect(first.artifacts.plan).to.equal(undefined);
    expect(first.artifacts.spec?.missing).to.include("Design");
    expect(r.intents[1].artifacts.intent?.status).to.equal(null);
  });

  it("only intents/<NN-slug>/: other folder names are skipped with a reason; issues/<n>/ is never read", async () => {
    const t = tree({
      [LIFECYCLE_POLICY_PATH]: POLICY,
      "projects/PRJ-1-x/intents/01-ok/intent.md": art("**Status:** DRAFT"),
      "projects/PRJ-1-x/intents/1-short/intent.md": art("**Status:** DRAFT"),
      "projects/PRJ-1-x/intents/03_Bad/intent.md": art("**Status:** DRAFT"),
      "projects/PRJ-1-x/intents/README.md": "about intents",
      "projects/PRJ-1-x/issues/7/intent.md": art("**Status:** DRAFT"),
    });
    const r = await scanIntents(t, "PRJ-1-x");
    if (!r.active) throw new Error("expected active");
    expect(r.intents.map((i) => i.id)).to.deep.equal(["01-ok"]);
    expect(r.skipped.map((s) => s.path)).to.deep.equal(["projects/PRJ-1-x/intents/03_Bad", "projects/PRJ-1-x/intents/1-short"]);
    expect(r.skipped[0].reason).to.match(/NN-slug/);
    expect(t.reads.some((p) => p.includes("/issues/"))).to.equal(false);
  });

  it("a project with no intents folder → active, empty", async () => {
    const r = await scanIntents(tree({ [LIFECYCLE_POLICY_PATH]: POLICY }), "PRJ-1-x");
    expect(r.active && r.intents).to.deep.equal([]);
  });

  it("refuses a project id that is a path", async () => {
    let err: unknown;
    try { await scanIntents(tree({ [LIFECYCLE_POLICY_PATH]: POLICY }), "../etc"); } catch (e) { err = e; }
    expect(String(err)).to.match(/project/);
  });
});

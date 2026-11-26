// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * F136 G2 (ruling Q42 C): a new governance repository carries the approval check and the rules' checks from the
 * setup commit — rendered from the working tree, on every plan and either posture.
 */
import { expect } from "chai";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { firstRunWorkflows, protectAtFirstRun } from "../../src/setup/first-run-workflows.js";
import type { PostureChoice } from "../../src/config/governance.js";
import { fsTree, type TreeReader } from "../../src/rules/policy-pr/tree.js";
import { WORKFLOW_DEST } from "../../src/maintain/repo-protect.js";
import { WORKFLOW_PATH } from "../../src/rules/checks/render-github.js";
import type { CheckVerbConfig } from "../../src/cli/check-verb.js";

const here = dirname(fileURLToPath(import.meta.url));
const CONTENT = resolve(here, "../../../../content");          // laid out as setup seeds it
/** The content tree with the org-config setup would have written by now (an org slug is the org store's scope). */
const seeded = (): TreeReader => {
  const t = fsTree(CONTENT);
  return { files: (d) => [...t.files(d), ...(d === "org-config.yaml" ? ["org-config.yaml"] : [])], read: (f) => (f === "org-config.yaml" ? 'org_slug: "acme"\ngithub_org: "acme"\n' : t.read(f)) };
};
const CFG: CheckVerbConfig = { home: CONTENT, defaultBranch: "main", defaultCodeBranch: "main", githubOrg: "acme", workspaceRepo: "acme-gov", posture: "soft" };

describe("F136 G2 — the checks are in the setup commit", () => {
  it("both workflows: the approver check, and gov-checks with the governance repo's pull-request gates", () => {
    const r = firstRunWorkflows(seeded(), CFG);
    expect(r.ok, r.ok ? "" : r.reason).to.equal(true);
    if (!r.ok) return;
    expect(r.files.map((f) => f.path)).to.deep.equal([WORKFLOW_DEST, WORKFLOW_PATH]);
    expect(r.files[0]!.text).to.contain("name: approver-check");
    const checks = r.files[1]!.text;
    for (const id of ["GOV-FRM-040", "GOV-FRM-455", "GOV-FRM-467"]) expect(checks, id).to.contain(id);
  });

  it("the same under hard posture — posture decides protection, never whether the checks exist", () => {
    const soft = firstRunWorkflows(seeded(), CFG);
    const hard = firstRunWorkflows(seeded(), { ...CFG, posture: "hard" });
    expect(hard).to.deep.equal(soft);
  });

  it("the organization's runner is asked for", () => {
    const r = firstRunWorkflows(seeded(), { ...CFG, runner: { runsOn: "self-hosted", chosen: true, problem: null } });
    expect(r.ok && r.files.every((f) => /runs-on: self-hosted/.test(f.text))).to.equal(true);
  });

  it("no template, or a runner gov cannot write, is a reason — nothing half-written", () => {
    const empty: TreeReader = { files: () => [], read: () => null };
    const none = firstRunWorkflows(empty, CFG);
    expect(none.ok).to.equal(false);
    const bad = firstRunWorkflows(seeded(), { ...CFG, runner: { runsOn: "x", chosen: true, problem: "names a runner gov cannot write" } });
    expect(bad.ok === false && bad.reason).to.contain("cannot write");
  });
});

describe("F136 G2 — protection at first run: hard posture only, and a refusal never fails setup", () => {
  const posture = (p: "hard" | "soft" | null, raw = p ?? "x"): PostureChoice => ({ posture: p, raw, unrecognised: p === null });
  const run = async (input: { pushed: boolean; posture: PostureChoice }, code = 0) => {
    const lines: string[] = [];
    let calls = 0;
    const r = await protectAtFirstRun(input, () => { calls++; return code; }, (l) => lines.push(l));
    return { r, calls, text: lines.join("\n") };
  };

  it("soft — the default — protects nothing (spec §11.1 unchanged)", async () => {
    const { r, calls } = await run({ pushed: true, posture: posture("soft") });
    expect(r).to.equal("soft");
    expect(calls).to.equal(0);
  });

  it("a posture gov does not recognise protects nothing either", async () => {
    expect((await run({ pushed: true, posture: posture(null) })).calls).to.equal(0);
  });

  it("hard, pushed → `gov repo protect apply` runs once", async () => {
    const { r, calls } = await run({ pushed: true, posture: posture("hard") });
    expect(r).to.equal("protected");
    expect(calls).to.equal(1);
  });

  it("hard, and the platform refuses (a private repository on GitHub Free) → setup carries on, and says it is NOT protected", async () => {
    const { r, text } = await run({ pushed: true, posture: posture("hard") }, 1);
    expect(r).to.equal("not-protected");
    expect(text).to.contain("NOT protected").and.to.contain("gov repo protect apply");
  });

  it("hard, but the setup commit never reached GitHub → nothing is attempted, and the command is named", async () => {
    const { r, calls, text } = await run({ pushed: false, posture: posture("hard") });
    expect(r).to.equal("not-pushed");
    expect(calls).to.equal(0);
    expect(text).to.contain("gov repo protect apply");
  });
});

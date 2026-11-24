// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
//
// Q65 A (Policy Owner, 2026-11-24): `gov rules propose` does not refuse for want of a model when nothing in the change
// needs one. A fresh organization approves no model, and its practice task (F136, "Put our name on the policy") edits
// only the title page — no numbered section, so no rule rows to draft. Then only the deterministic writers run
// (VERSION, the history snapshot, the changelog), as GOV-FRM-467 requires. A reworded section still needs the model,
// and the refusal names it and says how to approve one.
//
// The content is the real seeded content (publish/content), with setup's token substitution applied.
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { expect } from "chai";
import { memTree, treeAsGit } from "../../../src/rules/policy-pr/tree.js";
import { judgePolicyPr } from "../../../src/rules/policy-pr/gate.js";
import { rulesPropose } from "../../../src/cli/rules-propose.js";
import { chooseModel, lazyModel } from "../../../src/rules/propose/providers/index.js";
import { readModelSettings } from "../../../src/rules/propose/model-settings.js";
import { setupTokenValues, substituteTokens } from "../../../src/setup/create.js";
import { PRACTICE_FILE } from "../../../src/lifecycle/starter-project.js";
import type { GitRead } from "../../../src/cli/policy-gate-io.js";
import type { InterviewChannel } from "../../../src/rules/propose/interview.js";

const CONTENT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../../content");
const TODAY = "2026-11-24";

/** The governance repository a fresh setup leaves: the seeded content, its tokens filled, no model approved. */
function freshOrg(): Record<string, string> {
  const raw: Record<string, string> = {};
  const walk = (rel: string): void => {
    for (const e of fs.readdirSync(path.join(CONTENT, rel), { withFileTypes: true })) {
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) walk(r);
      else raw[r] = fs.readFileSync(path.join(CONTENT, r), "utf8");
    }
  };
  walk("");
  const orgConfig = "org_name: \"Acme Incorporated\"\norg_short_name: \"Acme\"\norg_slug: \"ACME\"\ngithub_org: \"acme\"\ndefault_branch: \"main\"\n";
  const governance = raw["policies/governance.yaml"]!.replace(/^(policy_owner:\n {2}email: ""\n {2}github: )""/m, "$1\"polly\"");
  const values = setupTokenValues(orgConfig, governance, TODAY);
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw)) out[k] = substituteTokens(v, values);
  out["org-config.yaml"] = orgConfig;
  out["policies/governance.yaml"] = substituteTokens(governance, values);
  return out;
}

/** git over the default branch only (`main`, merge-base `MB`). */
const gitOver = (base: Record<string, string>): GitRead => {
  const tg = treeAsGit(memTree(base));
  return (repo, args) => (args[0] === "merge-base" ? "MB\n" : args[0] === "rev-parse" ? null : tg(repo, args));
};
const noAnswers: InterviewChannel = { async ask() { return { kind: "pending" }; } };

/** The model a fresh org has: none approved — and a count of every time anything asked for one. */
function freshModel(base: Record<string, string>) {
  const s = readModelSettings(base["policies/governance.yaml"]!);
  const asked = { n: 0 };
  const port = lazyModel(() => { asked.n++; return chooseModel(s, { ci: false, anthropicKey: () => null, geminiKey: () => null, runCommand: () => "" }); });
  return { asked, port, settings: s };
}

const run = (base: Record<string, string>, head: Record<string, string>, model: ReturnType<typeof freshModel>, pr?: number) =>
  rulesPropose({ git: gitOver(base), head: memTree(head), channel: noAnswers, model: () => model.port },
    { home: "/gov", defaultBranch: "main", all: false, today: TODAY, author: "alice", ...(pr !== undefined ? { pr } : {}) });

describe("GOV-FRM-467 Q65 A — gov rules propose needs no model when the change rewords no section", () => {
  it("a fresh org approves no model (the premise)", () => {
    expect(freshModel(freshOrg()).settings.provider).to.equal(null);
  });

  it("the practice task's title-page edit → VERSION patch bump, history snapshot and changelog; the gate passes; no model asked", async () => {
    const base = freshOrg();
    const head = { ...base };
    head[PRACTICE_FILE] = base[PRACTICE_FILE]!
      .replace(/^( {2}title:).*$/m, "$1 \"Acme Development and Operations Policy\"")
      .replace(/^( {2}approved_by:).*$/m, "$1 \"Policy Owner\"");
    expect(head[PRACTICE_FILE]).to.not.equal(base[PRACTICE_FILE]);
    const model = freshModel(base);

    const r = await run(base, head, model, 1);
    expect(r.code, r.lines.join("\n")).to.equal(0);
    expect(model.asked.n, "no section needed reading, so no model was chosen").to.equal(0);
    expect(r.lines.join("\n")).to.contain("0 section(s) read").and.contain("patch (1.0.0 → 1.0.1)");
    expect(head["policies/VERSION"]).to.equal("1.0.1\n");
    expect(head[`policies/history/1.0.0/${path.basename(PRACTICE_FILE)}`]).to.equal(base[PRACTICE_FILE]);
    expect(head["policies/CHANGELOG.md"]).to.contain("## 1.0.1 — 2026-11-24").and.contain("| #1 | @alice |");
    expect(judgePolicyPr({ base: memTree(base), head: memTree(head), pr: 1, today: TODAY }).findings).to.deep.equal([]);
  });

  it("a reworded policy section with no model → still refuses, naming the section, why it needs the model, and how to approve one", async () => {
    const base = freshOrg();
    const head = { ...base };
    const doc = "policies/build/approved-technologies.md";
    const m = /^(##+ +([\d.]+)\b.*\n)/m.exec(base[doc]!);
    expect(m, `${doc} has a numbered section`).to.not.equal(null);
    head[doc] = base[doc]!.replace(m![1]!, `${m![1]!}\nEvery team reviews this list each quarter.\n`);
    const before = JSON.stringify(head);
    const model = freshModel(base);

    const r = await run(base, head, model, 1);
    const out = r.lines.join("\n");
    expect(r.code, out).to.equal(1);
    expect(out).to.contain("has not approved a language model").and.contain("policies/governance.yaml").and.contain("models:");
    expect(out).to.contain(`${doc} §${m![2]!} — reworded, with no rule rows yet`);
    expect(out).to.contain("needs no").and.contain("Nothing more was written");
    expect(JSON.stringify(head), "nothing was written").to.equal(before);
  });
});

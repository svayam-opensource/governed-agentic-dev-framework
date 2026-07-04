// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
import { expect } from "chai";
import { proposeKnowledge, submitKnowledge, archiveKnowledge, knowledgeBranch } from "../../src/lifecycle/knowledge.js";
import type { Vcs } from "../../src/lifecycle/vcs.js";
import type { Pulls } from "../../src/lifecycle/pulls.js";

const CONFIG = { defaultBranch: "main", githubOrg: "Svayamtech", workspaceRepo: "svm-prj-work" };

function recVcs() {
  const log: string[] = [];
  const vcs = {
    fetch: (_d: string, _r: string, b: string) => log.push(`fetch ${b}`),
    checkout: (_d: string, b: string) => log.push(`checkout ${b}`),
    checkoutNew: (_d: string, b: string) => log.push(`checkoutNew ${b}`),
    push: (_d: string, _r: string, b: string) => log.push(`push ${b}`),
    tag: (_d: string, n: string) => log.push(`tag ${n}`),
    pushDelete: (_d: string, _r: string, b: string) => log.push(`pushDelete ${b}`),
    branchDelete: (_d: string, b: string) => log.push(`branchDelete ${b}`),
  } as unknown as Vcs;
  return { vcs, log };
}

describe("prj-work — knowledge lifecycle", () => {
  it("propose creates + pushes a knowledge-<slug> branch off default", () => {
    const { vcs, log } = recVcs();
    const r = proposeKnowledge(vcs, CONFIG, "/gov", "api-patterns");
    expect(r.ok).to.equal(true);
    expect(knowledgeBranch("api-patterns")).to.equal("knowledge-api-patterns");
    expect(log).to.deep.equal(["fetch main", "checkout main", "checkoutNew knowledge-api-patterns", "push knowledge-api-patterns"]);
  });

  it("submit opens a PR knowledge-<slug> → default", () => {
    const created: string[] = [];
    const pulls: Pulls = { create: (repo, base, head, title) => { created.push(`${repo} ${head}->${base} ${title}`); return "https://pr/1"; }, merge: () => "merged" };
    const r = submitKnowledge(pulls, CONFIG, "api-patterns", "propose API patterns");
    expect(r.ok).to.equal(true);
    if (r.ok) expect(r.lines[0]).to.match(/https:\/\/pr\/1/);
    expect(created[0]).to.equal("Svayamtech/svm-prj-work knowledge-api-patterns->main knowledge: api-patterns");
  });

  it("archive tags + deletes the merged branch", () => {
    const { vcs, log } = recVcs();
    const r = archiveKnowledge(vcs, CONFIG, "/gov", "api-patterns");
    expect(r.ok).to.equal(true);
    expect(log).to.include("tag archive/knowledge-api-patterns");
  });

  it("each subcommand requires a slug (usage, exit 2)", () => {
    const { vcs } = recVcs();
    expect(proposeKnowledge(vcs, CONFIG, "/gov", "")).to.include({ ok: false, code: 2 });
  });
});

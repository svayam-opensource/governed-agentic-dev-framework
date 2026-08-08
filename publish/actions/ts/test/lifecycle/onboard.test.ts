// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
import { expect } from "chai";
import { onboard } from "../../src/lifecycle/onboard.js";
import type { Vcs } from "../../src/lifecycle/vcs.js";
import type { Fs } from "../../src/lifecycle/fs-io.js";
import type { Pulls } from "../../src/lifecycle/pulls.js";
import { px } from "../helpers/paths.js";

const CONFIG = { agentWorkRoot: "/awr", workspaceRepo: "svm-prj-work", orgName: "Svayam" };
const INPUT = { repoUrl: "https://github.com/Svayamtech/new-svc", description: "a new service", owner: "team-x" };

function world(opts: { hasKnowledge?: boolean; remoteBranch?: boolean } = {}) {
  const log: string[] = [];
  const writes: string[] = [];
  const cloned: string[] = [];
  const vcs = {
    remoteBranchExists: () => opts.remoteBranch ?? false,
    defaultBranch: () => "main",
    fetch: () => log.push("fetch"),
    checkout: (_d: string, b: string) => log.push(`checkout ${b}`),
    checkoutNew: (_d: string, b: string) => log.push(`checkoutNew ${b}`),
    addPath: (_d: string, p: string) => log.push(`add ${p}`),
    commit: (_d: string, m: string) => log.push(`commit ${m}`),
    push: (_d: string, _r: string, b: string) => log.push(`push ${b}`),
  } as unknown as Vcs;
  const fs = {
    pathExists: (p: string) => (px(p).endsWith("knowledge") ? (opts.hasKnowledge ?? false) : false),
    writeFile: (f: string) => writes.push(f),
    mkdirp: () => {}, readFile: () => null, rm: () => {}, readdir: () => [],
  } as Fs;
  const pulls: Pulls = { create: () => "https://github.com/Svayamtech/new-svc/pull/1", merge: () => "merged" };
  return { deps: { vcs, fs, pulls, cloneRepo: (u: string, d: string) => cloned.push(`${u}->${d}`), log: (m: string) => log.push(m) }, log, writes, cloned };
}

describe("prj-work — onboard", () => {
  it("clones, scaffolds knowledge/, commits, pushes onboard-knowledge, opens a PR", () => {
    const w = world();
    const r = onboard(w.deps, CONFIG, INPUT);
    expect(r.ok).to.equal(true);
    if (!r.ok) return;
    expect(r.branch).to.equal("onboard-knowledge");
    expect(w.cloned[0]).to.match(/new-svc->\/awr\/onboard\/new-svc/);
    // scaffolded the four knowledge files
    expect(w.writes.some((f) => f.endsWith("knowledge/agent.md"))).to.equal(true);
    expect(w.writes.filter((f) => f.includes("knowledge/repo/"))).to.have.lengthOf(3);
    // branched + committed + pushed
    expect(w.log).to.include("checkoutNew onboard-knowledge");
    expect(w.log).to.include("push onboard-knowledge");
    expect(r.lines.some((l) => /PR: /.test(l))).to.equal(true);
  });

  it("hard-stops if knowledge/ already exists", () => {
    const r = onboard(world({ hasKnowledge: true }).deps, CONFIG, INPUT);
    expect(r).to.include({ ok: false, reason: "knowledge-exists" });
  });

  it("hard-stops if the onboard branch already exists remotely", () => {
    const r = onboard(world({ remoteBranch: true }).deps, CONFIG, INPUT);
    expect(r).to.include({ ok: false, reason: "branch-exists" });
  });
});

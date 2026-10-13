// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
//
// `gov evidence report` (spec 02 §3.5, Q6): the paid module generates; gov commits the files on `gov/evidence` from a
// temporary worktree of origin/gov/evidence — never the person's checkout, never the default branch — and pushes
// fast-forward only. Without the module: one line, exit 1, nothing written.
import { expect } from "chai";
import { evidenceCommand, type EvidenceDeps, type ReportDeps } from "../../src/cli/evidence-verb.js";
import type { ReportRequest, ReportResult } from "../../src/check-seam/public.js";

const OK_FILES = [
  "evidence/reports/soc2-cc8/2026-07-01_2026-09-30/report.md",
  "evidence/reports/soc2-cc8/2026-07-01_2026-09-30/manifest.json",
];

function world(over: Partial<ReportDeps> = {}, result: ReportResult | (() => Promise<ReportResult>) = { ok: true, files: OK_FILES, lines: ["soc2-cc8: 3 controls, 12 changes"] }) {
  const git: string[][] = [];
  const reqs: ReportRequest[] = [];
  const removed: string[] = [];
  const copied: string[][] = [];
  let worktrees = 0;
  const report: ReportDeps = {
    generator: async () => ({ generate: async (r) => { reqs.push(r); return typeof result === "function" ? result() : result; } }),
    home: (g) => ({ ok: true, home: g ?? "/gov" }),
    tmpDir: () => "/tmp/gov-report-x/wt",
    git: (cwd, args) => {
      git.push([cwd, ...args]);
      if (args[0] === "worktree" && args[1] === "add") worktrees++;
      if (args[0] === "worktree" && args[1] === "remove") worktrees--;
      if (args[0] === "diff") return null; // staged changes exist
      if (args[0] === "rev-parse") return "abc1234\n";
      return "";
    },
    copyPolicies: (from, to) => { copied.push([from, to]); },
    removeDir: (abs) => { removed.push(abs); },
    ...over,
  };
  const deps: EvidenceDeps = { source: () => ({ ok: false, line: "unused" }), report };
  return { deps, git, reqs, removed, copied, open: () => worktrees };
}

const FLAGS = { pack: "soc2-cc8", from: "2026-07-01", to: "2026-09-30" };

describe("gov evidence report", () => {
  it("passes its arguments to the module exactly (repo and format included) with the temp checkout as govHome", async () => {
    const w = world();
    const r = await evidenceCommand(["report"], { ...FLAGS, repo: "acme-api", format: "html" }, w.deps);
    expect(r.code, r.lines.join("\n")).to.equal(0);
    expect(w.reqs).to.deep.equal([{ pack: "soc2-cc8", from: "2026-07-01", to: "2026-09-30", repo: "acme-api", format: "html", govHome: "/tmp/gov-report-x/wt" }]);
    expect(r.lines.join("\n")).to.match(/3 controls, 12 changes/);
  });

  it("defaults the format to md and leaves repo out when not given", async () => {
    const w = world();
    await evidenceCommand(["report"], FLAGS, w.deps);
    expect(w.reqs[0]).to.deep.equal({ pack: "soc2-cc8", from: "2026-07-01", to: "2026-09-30", format: "md", govHome: "/tmp/gov-report-x/wt" });
  });

  it("usage errors (exit 2) before the module is even started: no pack, a bad date, from after to, an unknown format", async () => {
    for (const flags of [{ from: FLAGS.from, to: FLAGS.to }, { ...FLAGS, from: "07/01" }, { ...FLAGS, from: "2026-10-01" }, { ...FLAGS, format: "pdf" }, { pack: "soc2-cc8", from: FLAGS.from }]) {
      let started = 0;
      const w = world({ generator: async () => { started++; return null; } });
      const r = await evidenceCommand(["report"], flags, w.deps);
      expect(r.code, JSON.stringify(flags)).to.equal(2);
      expect(started).to.equal(0);
      expect(w.git).to.have.length(0);
    }
  });

  it("no module: ONE plain line pointing at the subscription, exit 1, nothing written, git untouched", async () => {
    const w = world({ generator: async () => null });
    const r = await evidenceCommand(["report"], FLAGS, w.deps);
    expect(r.code).to.equal(1);
    expect(r.lines).to.have.length(1);
    expect(r.lines[0]).to.match(/subscription/).and.match(/portal\.svayamtech\.com/);
    expect(w.git).to.have.length(0);
    expect(w.copied).to.have.length(0);
    expect(w.removed).to.have.length(0);
  });

  it("a broken chain: exit 1, names the file and line, nothing committed or pushed, worktree gone", async () => {
    const w = world({}, { ok: false, files: [], lines: ["chain broken"], broken: { file: "evidence/2026/07/15/ci-1.jsonl", line: 3, reason: "record hash mismatch" } });
    const r = await evidenceCommand(["report"], FLAGS, w.deps);
    const out = r.lines.join("\n");
    expect(r.code).to.equal(1);
    expect(out).to.match(/evidence\/2026\/07\/15\/ci-1\.jsonl/).and.match(/line 3/).and.match(/record hash mismatch/);
    expect(w.git.some((a) => a[1] === "commit" || a[1] === "push")).to.equal(false);
    expect(w.open()).to.equal(0);
    expect(w.removed).to.have.length(1);
  });

  it("success: the files are committed on gov/evidence from a temp worktree of origin/gov/evidence, pushed fast-forward — never the default branch", async () => {
    const w = world();
    const r = await evidenceCommand(["report"], FLAGS, w.deps);
    expect(r.code, r.lines.join("\n")).to.equal(0);
    const add = w.git.find((a) => a[1] === "worktree" && a[2] === "add")!;
    expect(add).to.include("origin/gov/evidence");
    const staged = w.git.find((a) => a[1] === "add")!;
    expect(staged[0]).to.equal("/tmp/gov-report-x/wt");
    expect(staged.slice(-OK_FILES.length)).to.deep.equal(OK_FILES);
    const commit = w.git.find((a) => a[1] === "commit")!;
    expect(commit[0]).to.equal("/tmp/gov-report-x/wt");
    const push = w.git.find((a) => a[1] === "push")!;
    expect(push.slice(-2)).to.deep.equal(["origin", "HEAD:refs/heads/gov/evidence"]);
    expect(push.join(" ")).to.not.match(/--force|-f\b|\+/);
    for (const a of w.git) {
      expect(a.join(" "), "no git command names the default branch").to.not.match(/\b(main|master|dev|uat)\b/);
      expect(a.join(" ")).to.not.match(/checkout|switch|reset --hard/);
      if (a[1] === "commit" || a[1] === "add" || a[1] === "push") expect(a[0], "only ever in the temp worktree").to.equal("/tmp/gov-report-x/wt");
    }
    expect(w.copied).to.deep.equal([["/gov", "/tmp/gov-report-x/wt"]]);
    expect(w.open()).to.equal(0);
    expect(r.lines.join("\n")).to.match(/gov\/evidence/).and.match(/report\.md/);
  });

  it("refuses to commit anything outside evidence/reports/ (a module that writes elsewhere)", async () => {
    const w = world({}, { ok: true, files: [...OK_FILES, "policies/packs/evil.yaml"], lines: [] });
    const r = await evidenceCommand(["report"], FLAGS, w.deps);
    expect(r.code).to.equal(1);
    expect(r.lines.join("\n")).to.match(/outside evidence\/reports/);
    expect(w.git.some((a) => a[1] === "commit" || a[1] === "push")).to.equal(false);
    expect(w.open()).to.equal(0);
  });

  it("the temp worktree is removed even when the module throws or the push is refused", async () => {
    const t = world({}, async () => { throw new Error("module exploded"); });
    const rt = await evidenceCommand(["report"], FLAGS, t.deps);
    expect(rt.code).to.equal(1);
    expect(rt.lines.join("\n")).to.match(/module exploded/);
    expect(t.open()).to.equal(0);
    expect(t.removed).to.have.length(1);

    const p = world({ git: (cwd, args) => { if (args[0] === "worktree" && args[1] === "remove") return ""; return args[0] === "push" ? null : args[0] === "diff" ? null : ""; } });
    const rp = await evidenceCommand(["report"], FLAGS, p.deps);
    expect(rp.code).to.equal(1);
    expect(rp.lines.join("\n")).to.match(/not pushed|rejected|could not push/i);
    expect(p.removed).to.have.length(1);
  });

  it("an unchanged report (nothing staged) commits and pushes nothing, and says so", async () => {
    const w = world({ git: (cwd, args) => { w2.push([cwd, ...args]); return ""; } });
    const w2: string[][] = [];
    const r = await evidenceCommand(["report"], FLAGS, w.deps);
    expect(r.code).to.equal(0);
    expect(w2.some((a) => a[1] === "commit" || a[1] === "push")).to.equal(false);
    expect(r.lines.join("\n")).to.match(/already/i);
  });

  it("no evidence branch to fetch: exit 1 with a plain line, worktree never created", async () => {
    const g: string[][] = [];
    const w = world({ git: (cwd, args) => { g.push([cwd, ...args]); return args[0] === "fetch" ? null : ""; } });
    const r = await evidenceCommand(["report"], FLAGS, w.deps);
    expect(r.code).to.equal(1);
    expect(r.lines.join("\n")).to.match(/gov evidence enable/);
    expect(g.some((a) => a[1] === "worktree")).to.equal(false);
  });
});

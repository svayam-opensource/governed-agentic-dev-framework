// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
//
// `gov pack add <id>` OPENS A POLICY PULL REQUEST (spec 02 §3.5, A9; Q7 paths). The pack's prose goes to
// `policies/common/packs/<id>.md` and its control map to `policies/packs/<id>.yaml` — on a new branch, in a separate
// worktree, through one `gh pr create`. Nothing is written to the default branch, nothing to the person's own working
// tree. Without the paid module there is no pack to add: one plain line.
import { expect } from "chai";
import { packCommand, type PackDeps } from "../../src/cli/pack-verb.js";
import type { PackRegistry } from "../../src/check-seam/public.js";
import { pxAll } from "../helpers/paths.js";

const REGISTRY: PackRegistry = {
  list: () => [
    { id: "soc2-cc8", version: "1.0.0", title: "SOC 2 CC8.1 change management", mappingStatus: "not-audited" },
    { id: "rbi-cm", version: "1.0.0", title: "RBI IT governance — change and patch management", mappingStatus: "not-audited" },
  ],
  proposal: (id) => (id === "soc2-cc8"
    ? { files: [{ path: "policies/common/packs/soc2-cc8.md", text: "# SOC 2 CC8\n" }, { path: "policies/packs/soc2-cc8.yaml", text: "controls: []\n" }] }
    : null),
};

function world(over: Partial<PackDeps> = {}) {
  const git: string[][] = [];
  const gh: string[][] = [];
  const written: Record<string, string> = {};
  const deps: PackDeps = {
    home: "/gov",
    defaultBranch: "main",
    today: "2026-10-13",
    tmpDir: () => "/tmp/gov-pack-x",
    git: (cwd, args) => { git.push([cwd, ...args]); return args[0] === "rev-parse" && args.includes("--verify") ? null : ""; },
    gh: (cwd, args) => { gh.push([cwd, ...args]); return "https://github.com/acme/acme-gov/pull/9\n"; },
    writeFile: (abs, text) => { written[abs] = text; },
    removeDir: () => undefined,
    packs: async () => REGISTRY,
    ...over,
  };
  return { deps, git, gh, written };
}

describe("gov pack (A9)", () => {
  it("add: one PR, the two Q7 paths, a new branch in its own worktree — never the default branch", async () => {
    const w = world();
    const r = await packCommand(["add", "soc2-cc8"], w.deps);
    expect(r.code, r.lines.join("\n")).to.equal(0);
    expect(pxAll(Object.keys(w.written)).sort()).to.deep.equal([
      "/tmp/gov-pack-x/policies/common/packs/soc2-cc8.md",
      "/tmp/gov-pack-x/policies/packs/soc2-cc8.yaml",
    ]);
    const add = w.git.find((a) => a[1] === "worktree" && a[2] === "add")!;
    expect(add).to.include("origin/main");
    const branch = add[add.indexOf("-b") + 1]!;
    expect(branch).to.equal("gov-pack-soc2-cc8-2026-10-13");
    const push = w.git.find((a) => a[1] === "push")!;
    expect(push.slice(-2)).to.deep.equal(["origin", `${branch}:${branch}`]);
    for (const a of w.git) {
      expect(a.join(" "), "never pushes or checks out the default branch").to.not.match(/push.*\bmain\b|checkout main/);
      expect(a[0], "never commits in the person's own tree").to.satisfy((cwd: string) => a[1] === "worktree" || a[1] === "fetch" || a[1] === "rev-parse" || cwd === "/tmp/gov-pack-x");
    }
    expect(w.gh).to.have.length(1);
    const pr = w.gh[0]!;
    expect(pr.slice(1, 3)).to.deep.equal(["pr", "create"]);
    expect(pr).to.include("--base").and.include("main");
    expect(pr.join(" ")).to.match(/mapping not audited/i);
    expect(r.lines.join("\n")).to.contain("https://github.com/acme/acme-gov/pull/9");
  });

  it("add: an unknown pack → exit 1, nothing written, no PR", async () => {
    const w = world();
    const r = await packCommand(["add", "dora"], w.deps);
    expect(r.code).to.equal(1);
    expect(w.written).to.deep.equal({});
    expect(w.gh).to.deep.equal([]);
  });

  it("without the paid module: one plain line; add exits 1, list exits 0", async () => {
    const w = world({ packs: async () => null });
    const add = await packCommand(["add", "soc2-cc8"], w.deps);
    expect(add.code).to.equal(1);
    expect(add.lines).to.have.length(1);
    expect(add.lines[0]).to.match(/subscription/);
    const list = await packCommand(["list"], w.deps);
    expect(list.code).to.equal(0);
    expect(list.lines).to.have.length(1);
    expect(w.git).to.deep.equal([]);
  });

  it("list: every pack with its mapping status", async () => {
    const r = await packCommand(["list"], world().deps);
    expect(r.lines.join("\n")).to.contain("soc2-cc8").and.contain("rbi-cm").and.contain("mapping not audited");
  });

  it("a failing push or PR → exit 1 with what to run by hand; the temporary worktree is removed either way", async () => {
    let removed = 0;
    const w = world({ gh: () => null, removeDir: () => { removed++; } });
    const r = await packCommand(["add", "soc2-cc8"], w.deps);
    expect(r.code).to.equal(1);
    expect(r.lines.join("\n")).to.contain("gh pr create");
    expect(removed).to.equal(1);
  });
});

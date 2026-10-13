// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * `gov upgrade --pr` WRITES ORDERED COMMITS AND SAYS WHAT IT DID (PRJ-121 intent 01, B02; rulings Q6, Q3).
 *
 * framework · org moves · migrations · proposed prose — in that order, an empty one omitted; the PR body lists every
 * move, retirement, migration and substitution, every entry left in place, and what to run after merging.
 */
import { expect } from "chai";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import { runUpgradePr, MOVES_FILE } from "../../src/maintain/upgrade-run.js";
import { commitSubject, unrecognisedEntries, upgradePrBody, NEXT_AFTER_MERGE, type UpgradeExtension } from "../../src/maintain/upgrade-commits.js";

const gitOk = (): boolean => { try { execFileSync("git", ["--version"], { stdio: "ignore" }); return true; } catch { return false; } };
const tmp = (p: string): string => fs.mkdtempSync(path.join(os.tmpdir(), p));
const write = (root: string, rel: string, text: string): void => { fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true }); fs.writeFileSync(path.join(root, rel), text); };

/** Content 2.0.0: one framework file, one org starter, a move of the org's file, a retirement. */
function content(): string {
  const c = tmp("govcm-content-");
  write(c, "MANIFEST.yaml", [
    'version: "2.0.0"',
    "files:",
    "  - { src: VERSION, dst: VERSION, mode: scaffold-auto }",
    "  - { src: framework/spec.md, dst: framework/spec.md, mode: scaffold-auto }",
    "  - { src: policies/VERSION, dst: policies/VERSION, mode: seed-once }",
    "moves:",
    "  - { from: policies/data.md, to: policies/common/data.md, mode: move }",
    "retire:",
    "  - framework/old.md",
    "",
  ].join("\n"));
  write(c, "VERSION", "2.0.0\n");
  write(c, "framework/spec.md", "# spec 2.0\n");
  write(c, "policies/VERSION", "1.0.0\n");
  return c;
}

interface Repo { dir: string; g: (...a: string[]) => string }
function repo(files: Record<string, string>): Repo {
  const remote = tmp("govcm-remote-");
  execFileSync("git", ["init", "-q", "--bare", remote]);
  const dir = tmp("govcm-adopter-");
  const g = (...a: string[]): string => execFileSync("git", ["-C", dir, ...a], { encoding: "utf8" }).trim();
  g("init", "-q", "-b", "main"); g("config", "user.email", "t@example.com"); g("config", "user.name", "t");
  g("remote", "add", "origin", remote);
  for (const [p, t] of Object.entries(files)) write(dir, p, t);
  g("add", "-A"); g("commit", "-qm", "seed");
  return { dir, g };
}

const FULL = {
  "VERSION": "1.0.0\n",
  "org-config.yaml": 'github_org: "acme"\n',
  "framework/old.md": "# retired by 2.0\n",
  "policies/data.md": "# our data policy — see policies/data.md\n",
  "notes/mine.txt": "the org's own notes, nothing gov knows\n",
};

/** A commit-4 step that rewrites one exact old path in the org's documents. */
const PROPOSE: UpgradeExtension = {
  propose: (dir) => {
    const p = path.join(dir, "policies/common/data.md");
    fs.writeFileSync(p, fs.readFileSync(p, "utf8").replace("policies/data.md", "policies/common/data.md"));
    return { substitutions: [{ file: "policies/common/data.md", from: "policies/data.md", to: "policies/common/data.md", count: 1 }], proposed: [] };
  },
};

function upgrade(r: Repo, ext: UpgradeExtension = {}): { code: number; out: string; body: string; subjects: string[] } {
  let body = "";
  const res = runUpgradePr(content(), r.dir, { userHome: tmp("govcm-home-"), extension: ext, openPr: (a) => { body = a.body; return "https://example.test/pr/1"; } });
  const subjects = res.code === 0 ? r.g("log", "--reverse", "--format=%s", "main..gov-upgrade-2.0.0").split("\n").filter(Boolean) : [];
  return { code: res.code, out: res.lines.join("\n"), body, subjects };
}

(gitOk() ? describe : describe.skip)("gov upgrade --pr — four ordered commits (Q6)", () => {
  it("framework · org moves · migrations · proposed prose, in that order, with their subjects", () => {
    const r = repo(FULL);
    const u = upgrade(r, PROPOSE);
    expect(u.code, u.out).to.equal(0);
    expect(u.subjects).to.deep.equal(["framework", "org-moves", "migrations", "proposed-prose"].map((c) => commitSubject(c as never, "2.0.0")));
    const files = (n: number): string[] => r.g("show", "--format=", "--name-only", "--no-renames", `gov-upgrade-2.0.0~${n}`).split("\n").filter(Boolean).sort();
    expect(files(3), "commit 1 — the framework's files").to.deep.equal(["VERSION", "framework/old.md", "framework/spec.md"]);
    expect(files(2), "commit 2 — the org's file, moved").to.deep.equal(["policies/common/data.md", "policies/data.md"]);
    expect(files(1), "commit 3 — the starter the org lacked, and the move record").to.deep.equal([MOVES_FILE, "policies/VERSION"].sort());
    expect(files(0), "commit 4 — the proposal").to.deep.equal(["policies/common/data.md"]);
    expect(r.g("rev-parse", "gov-upgrade-2.0.0~2:policies/common/data.md"), "moved byte for byte").to.equal(r.g("rev-parse", "main:policies/data.md"));
  });

  it("a commit with nothing in it is omitted — no moves, no proposals → two commits", () => {
    const r = repo({ "VERSION": "1.0.0\n", "org-config.yaml": 'github_org: "acme"\n' });
    const u = upgrade(r);
    expect(u.code, u.out).to.equal(0);
    expect(u.subjects).to.deep.equal([commitSubject("framework", "2.0.0"), commitSubject("migrations", "2.0.0")]);
    expect(u.out).to.match(/2 commit\(s\): framework · migrations/);
  });

  it("the body has every section, and lists the move, the retirement and the substitution", () => {
    const u = upgrade(repo(FULL), PROPOSE);
    for (const h of ["## Moved", "## Retired", "## Migrated", "## Substitutions", "## Left in place", "## Next, after merging"]) expect(u.body).to.include(h);
    expect(u.body).to.include("`policies/data.md` → `policies/common/data.md`");
    expect(u.body).to.include("`framework/old.md` — no longer shipped by this release");
    expect(u.body).to.match(/`policies\/common\/data\.md`: `policies\/data\.md` → `policies\/common\/data\.md`/);
    expect(u.body).to.match(/keep it, edit it in this branch, or drop it/);
    const next = u.body.slice(u.body.indexOf("## Next, after merging"));
    expect(NEXT_AFTER_MERGE.map((n) => next.indexOf(n.command)), "propose → build → protect → install, in order")
      .to.satisfy((ix: number[]) => ix.every((v, i) => v > 0 && (i === 0 || v > ix[i - 1]!)));
  });

  it("an unknown file is listed as left in place, and is untouched on the branch", () => {
    const r = repo(FULL);
    const u = upgrade(r);
    expect(u.body).to.include("- `notes/` — not recognised; left exactly where it is");
    expect(r.g("show", "gov-upgrade-2.0.0:notes/mine.txt")).to.equal(FULL["notes/mine.txt"].trimEnd());
    expect(r.g("diff", "--name-only", "main", "gov-upgrade-2.0.0", "--", "notes/")).to.equal("");
  });

  it("an extension's planned actions land in their commit, and its left-alone entries are listed with the reason", () => {
    const r = repo({ ...FULL, "knowledge/old/TEMPLATE.md": "# template\n", "knowledge/old/README.md": "# ours\n" });
    const ext: UpgradeExtension = {
      plan: () => ({
        actions: [{ kind: "retire", dst: "knowledge/old/TEMPLATE.md", detail: "the framework's template", commit: "org-moves" }],
        leftInPlace: [{ path: "knowledge/old/README.md", why: "the org's own — not moved by the bridge" }],
      }),
    };
    const u = upgrade(r, ext);
    expect(u.code, u.out).to.equal(0);
    expect(r.g("show", "--format=", "--name-only", "gov-upgrade-2.0.0~1").split("\n")).to.include("knowledge/old/TEMPLATE.md");
    expect(u.body).to.include("- `knowledge/old/README.md` — the org's own — not moved by the bridge");
  });
});

describe("upgrade-commits — the pure parts", () => {
  it("unrecognisedEntries names a wholly-unknown folder once, and files one by one where a folder is mixed", () => {
    const files = ["a/x.md", "a/y.md", "b/known.md", "b/stray.md", "CODEOWNERS", "policies/p.md", "knowledge/k.md", "old.txt", "VERSION"];
    const plan = { actions: [{ kind: "retire" as const, dst: "old.txt" }] };
    expect(unrecognisedEntries(files, plan, ["b/known.md", "VERSION"])).to.deep.equal(["a/", "b/stray.md"]);
  });

  it("a body with no commit 4 says nothing about dropping one, and says when nothing was left", () => {
    const body = upgradePrBody({ version: "2.0.0", plan: { actions: [] }, commits: [{ commit: "framework", files: 1 }], unrecognised: [] });
    expect(body).not.to.match(/drop it/);
    expect(body).to.include("Nothing unrecognised");
  });
});

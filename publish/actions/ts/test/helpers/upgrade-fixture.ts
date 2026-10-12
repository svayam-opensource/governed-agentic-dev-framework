// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * THE UPGRADE FIXTURES, MATERIALISED (PRJ-121 intent 01, B01, spec §8).
 *
 * Each fixture under `test/maintain/fixtures/upgrade/<name>/` is two text files, never a checked-in tree:
 *   paths.txt   every path the org's repo holds, one per line (`#` lines are comments)
 *   bodies.txt  the bodies that matter: `===== <path>` starts a file and its body runs, exactly, to the next such line;
 *               `===== <path> = <other>` gives <path> the bytes of <other>. Any path without a body gets a one-line
 *               placeholder.
 *
 * WHY NOT A TREE: a gov repo holds `.gitignore`, `CODEOWNERS`, `.github/workflows/`, `.claude/settings.json`,
 * `.cursor/rules/`, `AGENTS.md` — files that git, GitHub and every agent harness act on wherever they sit. Checked in as
 * files they would change how THIS repository behaves; as text they are inert, and the test writes them to a temp dir.
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { execFileSync } from "node:child_process";

export const UPGRADE_FIXTURES = path.join(import.meta.dirname, "..", "maintain", "fixtures", "upgrade");
/** The content this gov ships — what an upgrade brings a fixture to. */
export const SHIPPED_CONTENT = path.join(import.meta.dirname, "..", "..", "..", "..", "content");

export type FixtureName = "layout-1.0" | "flat-1.2.3" | "flat-with-org-rows";
export const FIXTURE_NAMES: readonly FixtureName[] = ["layout-1.0", "flat-1.2.3", "flat-with-org-rows"];

const placeholder = (p: string): string => `placeholder — sanitised fixture body for ${p}\n`;

/** Every file of the fixture, path → body. */
export function fixtureFiles(name: FixtureName): Map<string, string> {
  const dir = path.join(UPGRADE_FIXTURES, name);
  // A Windows checkout may turn LF into CRLF; the fixtures are LF, and fingerprints hash LF bytes.
  const read = (f: string): string => fs.readFileSync(path.join(dir, f), "utf8").replace(/\r\n/g, "\n");
  const paths = read("paths.txt").split("\n").filter((l) => l && !l.startsWith("#"));
  const bodies = new Map<string, string>();
  const text = read("bodies.txt");
  const heads = [...text.matchAll(/^===== (.+)$/gm)];
  heads.forEach((h, i) => {
    const start = h.index + h[0].length + 1;
    const end = i + 1 < heads.length ? heads[i + 1]!.index : text.length;
    const [p, same] = h[1]!.split(" = ");
    bodies.set(p!, same ? bodies.get(same) ?? (() => { throw new Error(`${name}: ${p} = ${same}, but ${same} has no body above it`); })() : text.slice(start, end));
  });
  for (const p of bodies.keys()) if (!paths.includes(p)) throw new Error(`${name}: bodies.txt names ${p}, which paths.txt does not list`);
  return new Map(paths.map((p) => [p, bodies.get(p) ?? placeholder(p)]));
}

export const tmpDir = (prefix: string): string => fs.mkdtempSync(path.join(os.tmpdir(), prefix));

/** Write the fixture into `dir`. */
export function materialise(name: FixtureName, dir: string): void {
  for (const [p, body] of fixtureFiles(name)) {
    fs.mkdirSync(path.dirname(path.join(dir, p)), { recursive: true });
    fs.writeFileSync(path.join(dir, p), body);
  }
}

export interface FixtureRepo {
  readonly dir: string;
  /** git in the fixture's clone. */
  readonly g: (...args: string[]) => string;
}

/** The fixture as a governance clone: one commit on `main`, with an `origin` (a local bare repo) to push to. `edit` overrides bodies. */
export function fixtureRepo(name: FixtureName, edit: Readonly<Record<string, string>> = {}): FixtureRepo {
  const remote = tmpDir("govfx-remote-");
  execFileSync("git", ["init", "-q", "--bare", remote]);
  const dir = tmpDir(`govfx-${name}-`);
  const g = (...a: string[]): string => execFileSync("git", ["-C", dir, ...a], { encoding: "utf8", maxBuffer: 64 << 20 }).trim();
  g("init", "-q", "-b", "main");
  g("config", "user.email", "fixture@example.test"); g("config", "user.name", "fixture"); g("config", "core.autocrlf", "false");
  g("remote", "add", "origin", remote);
  materialise(name, dir);
  for (const [p, body] of Object.entries(edit)) { fs.mkdirSync(path.dirname(path.join(dir, p)), { recursive: true }); fs.writeFileSync(path.join(dir, p), body); }
  g("add", "-A"); g("commit", "-qm", `fixture ${name}`);
  return { dir, g };
}

/** Every file under `root` (relative, `/`-separated), skipping `.git`. */
export function treeOf(root: string, rel = ""): string[] {
  return fs.readdirSync(path.join(root, rel)).flatMap((n) => {
    if (n === ".git") return [];
    const r = rel ? `${rel}/${n}` : n;
    return fs.statSync(path.join(root, r)).isDirectory() ? treeOf(root, r) : [r];
  }).sort();
}

/** Run `gov upgrade --pr` on a fixture clone: the result, the PR body, and the upgrade branch's commits oldest first. */
export function upgradeFixture(repo: FixtureRepo, run: (dir: string, openPr: (a: { body: string }) => string) => { code: number; lines: readonly string[] }): {
  code: number; out: string; body: string; branch: string; commits: { sha: string; subject: string }[];
} {
  let body = "";
  const r = run(repo.dir, (a) => { body = a.body; return "https://example.test/pr/1"; });
  const branch = repo.g("branch", "--list", "gov-upgrade-*", "--format=%(refname:short)").split("\n")[0] ?? "";
  const commits = branch ? repo.g("log", "--reverse", "--format=%H %s", `main..${branch}`).split("\n").filter(Boolean)
    .map((l) => ({ sha: l.slice(0, 40), subject: l.slice(41) })) : [];
  return { code: r.code, out: r.lines.join("\n"), body, branch, commits };
}

/** What one commit did: path → git status letter (A, M, D), renames shown as D + A. */
export function commitChanges(repo: FixtureRepo, sha: string): Map<string, string> {
  return new Map(repo.g("show", "--format=", "--name-status", "--no-renames", sha).split("\n").filter(Boolean).map((l) => {
    const [st, p] = l.split("\t");
    return [p!, st!];
  }));
}

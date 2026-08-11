// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * EXHAUSTIVE (full-cartesian) coverage for the gov-work CLI MAINTAIN commands.
 * These exercise the exported PURE functions/handlers directly (not route()):
 * every {flags present/absent} × {input state} × {error condition} combination,
 * for first-adopter-grade confidence. Overlap with the focused per-command tests
 * is acceptable; the value here is the cross-product.
 */
import { expect } from "chai";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { execFileSync } from "node:child_process";

import { doctor, formatDoctorReport, type DoctorFacts } from "../../src/maintain/doctor.js";
import { checkVersionCompat, type CompatStatus } from "../../src/maintain/version-compat.js";
import { checkDeps, formatDepsReport } from "../../src/maintain/deps.js";
import { publishGate, formatPublishGate } from "../../src/maintain/publish.js";
import { bumpVersion } from "../../src/maintain/bump-version.js";
import {
  parseManifest, expandEntries, planUpgrade, mergeOrgConfig, applyUpgrade, formatPlan,
  RETIRE_PATHS, type PlanReaders, type UpgradePlan, type ManifestEntry,
} from "../../src/maintain/upgrade-sync.js";
import { runUpgradeSync, runUpgradePr, fetchTemplateContent } from "../../src/maintain/upgrade-run.js";
import { runSetup } from "../../src/setup/setup-run.js";
import {
  parseOriginOwnerRepo, deriveOrgConfig, renderOrgConfig, readExistingOrgConfig,
  type OrgConfigValues,
} from "../../src/setup/setup.js";
import { runSuite, CORE_VALIDATORS } from "../../src/governance/suite.js";
import { runValidators, type ValidateContext } from "../../src/governance/validate.js";
import { makePrivacyValidator } from "../../src/governance/privacy.js";
import type { Fs } from "../../src/lifecycle/fs-io.js";
import type { ResolveResult } from "../../src/resolve/types.js";
import { px } from "../helpers/paths.js";

/** A writes-map keyed by normalised path, so a POSIX literal finds an entry the code wrote
 *  with the host separator (Windows). */
const pxKeys = (m: Record<string, string>): Record<string, string> =>
  Object.fromEntries(Object.entries(m).map(([k, v]) => [px(k), v]));

// ── shared fakes ────────────────────────────────────────────────────────────

/** An in-memory Fs over a repo-relative path → content map (rooted at /repo). */
function memFs(files: Record<string, string>): { fs: Fs; store: Record<string, string> } {
  const store = { ...files };
  const rel = (p: string) => px(p).replace(/^\/repo\//, "");
  return {
    fs: {
      pathExists: (p) => px(rel(p)) in store,
      readFile: (p) => store[rel(p)] ?? null,
      writeFile: (p, c) => { store[rel(p)] = c; },
      mkdirp: () => {},
      rm: () => {},
      readdir: () => [],
    },
    store,
  };
}

/** Directory-aware Fs (needed by knowledge link resolution) rooted at /repo. */
function workspaceCtx(files: Record<string, string>, extraDirs: string[] = []): ValidateContext {
  const existing = new Set<string>(extraDirs);
  for (const k of Object.keys(files)) {
    existing.add(k);
    let d = path.dirname(k);
    while (d && d !== "." && d !== "/") { existing.add(d); d = path.dirname(d); }
  }
  const fsx: Fs = {
    pathExists: (p) => existing.has(px(path.relative("/repo", p))),
    readFile: (p) => files[px(path.relative("/repo", p))] ?? null,   // key alike on both sides
    mkdirp: () => {}, writeFile: () => {}, rm: () => {}, readdir: () => [],
  };
  return { fs: fsx, repoRoot: "/repo", files: Object.keys(files) };
}

const RESOLVED: ResolveResult = { ok: true, home: "/gov", org: "Svayamtech", via: "active-org" };
const UNRESOLVED: ResolveResult = { ok: false, code: 2, reason: "no-active-org" };

const facts = (over: Partial<DoctorFacts> = {}): DoctorFacts => ({
  gitPresent: true, ghPresent: true, resolve: RESOLVED, activeOrg: "Svayamtech", cliVersion: "1.0.0", ...over,
});

// ── temp-dir bookkeeping for the fs-backed runner ───────────────────────────
const tmpdirs: string[] = [];
function mkTmp(prefix = "gov-cov-"): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tmpdirs.push(d);
  return d;
}
function write(dir: string, rel: string, text: string): void {
  const p = path.join(dir, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, text);
}
function gitOk(): boolean {
  try { execFileSync("git", ["--version"], { stdio: "ignore" }); return true; } catch { return false; }
}
function git(dir: string, args: string[]): void {
  execFileSync("git", ["-C", dir, "-c", "user.email=t@t.io", "-c", "user.name=t", "-c", "commit.gpgsign=false", ...args], { stdio: "ignore" });
}
after(() => { for (const d of tmpdirs) try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* ignore */ } });

// ════════════════════════════════════════════════════════════════════════════
// doctor
// ════════════════════════════════════════════════════════════════════════════
describe("coverage — doctor(facts): full cartesian", () => {
  // contentVersion → expected version-compat status (cliVersion fixed at 1.0.0)
  const contentCases: Array<[string, string | null | undefined, CompatStatus, "ok" | "warn" | "fail"]> = [
    ["no marker (undefined)", undefined, "no-marker", "ok"],
    ["no marker (null)", null, "no-marker", "ok"],
    ["equal", "1.0.0", "ok", "ok"],
    ["content-behind", "0.9.0", "content-behind", "warn"],
    ["cli-behind (same major)", "1.5.0", "cli-behind", "warn"],
    ["cli-behind-major", "2.0.0", "cli-behind-major", "fail"],
  ];

  it("crosses git × gh × resolve × activeOrg × contentVersion → overall ok verdict + compat status", () => {
    let n = 0;
    for (const gitPresent of [true, false])
      for (const ghPresent of [true, false])
        for (const resolveOk of [true, false])
          for (const activeOrg of ["Svayamtech", null] as const)
            for (const [, contentVersion, compatStatus, diagStatus] of contentCases) {
              n++;
              const r = doctor(facts({
                gitPresent, ghPresent,
                resolve: resolveOk ? RESOLVED : UNRESOLVED,
                activeOrg, contentVersion,
              }));
              const expectedOk = gitPresent && ghPresent && resolveOk && compatStatus !== "cli-behind-major";
              expect(r.ok, `git=${gitPresent} gh=${ghPresent} res=${resolveOk} compat=${compatStatus}`).to.equal(expectedOk);
              expect(r.diagnostics.find((d) => d.name === "version compat")!.status).to.equal(diagStatus);
              expect(r.diagnostics.find((d) => d.name === "git")!.status).to.equal(gitPresent ? "ok" : "fail");
              expect(r.diagnostics.find((d) => d.name === "gh")!.status).to.equal(ghPresent ? "ok" : "fail");
              expect(r.diagnostics.find((d) => d.name === "active org")!.status).to.equal(activeOrg ? "ok" : "warn");
            }
    expect(n).to.equal(2 * 2 * 2 * 2 * contentCases.length); // 96 combos
  });

  it("resolve diagnostic: ok shows home/org, fail shows the actionable failure message", () => {
    const okD = doctor(facts()).diagnostics.find((d) => d.name === "gov workspace")!;
    expect(okD.status).to.equal("ok");
    expect(okD.detail).to.equal("resolved → /gov (Svayamtech)");
    const failD = doctor(facts({ resolve: UNRESOLVED })).diagnostics.find((d) => d.name === "gov workspace")!;
    expect(failD.status).to.equal("fail");
    expect(failD.detail).to.match(/gov org use/);
  });

  it("staleArtifacts: empty/undefined → content layout ok; non-empty → warn pointing at gov upgrade", () => {
    for (const stale of [undefined, [] as string[]]) {
      const d = doctor(facts({ staleArtifacts: stale })).diagnostics.find((x) => x.name === "content layout")!;
      expect(d.status).to.equal("ok");
      expect(d.detail).to.equal("current");
    }
    const warn = doctor(facts({ staleArtifacts: ["framework/", "registry.yaml"] })).diagnostics.find((x) => x.name === "content layout")!;
    expect(warn.status).to.equal("warn");
    expect(warn.detail).to.match(/framework\/, registry\.yaml/);
    expect(warn.detail).to.match(/gov upgrade/);
  });

  it("CLI version diagnostic echoes the injected version and is always ok", () => {
    const d = doctor(facts({ cliVersion: "3.4.5" })).diagnostics.find((x) => x.name === "CLI version")!;
    expect(d).to.deep.include({ status: "ok", detail: "3.4.5" });
  });

  it("formatDoctorReport: one line per diagnostic + verdict; marks ✓/!/✗; verdict flips on failure", () => {
    const okLines = formatDoctorReport(doctor(facts()));
    expect(okLines).to.have.lengthOf(doctor(facts()).diagnostics.length + 1);
    expect(okLines[0]).to.match(/^ {2}✓ git:/);
    expect(okLines[okLines.length - 1]).to.equal("doctor: ok");
    // a warn-bearing report still renders a "!" mark and stays ok
    const warnLines = formatDoctorReport(doctor(facts({ activeOrg: null })));
    expect(warnLines.some((l) => /^ {2}! active org:/.test(l))).to.equal(true);
    expect(warnLines[warnLines.length - 1]).to.equal("doctor: ok");
    // a hard failure renders a "✗" mark and a FAILED verdict
    const failLines = formatDoctorReport(doctor(facts({ gitPresent: false })));
    expect(failLines.some((l) => /^ {2}✗ git:/.test(l))).to.equal(true);
    expect(failLines[failLines.length - 1]).to.match(/^doctor: FAILED/);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// version-compat
// ════════════════════════════════════════════════════════════════════════════
describe("coverage — checkVersionCompat: every status + boundaries", () => {
  const rows: Array<[string, string, string | null, CompatStatus, boolean]> = [
    ["equal", "1.2.0", "1.2.0", "ok", true],
    ["equal at 0.0.0", "0.0.0", "0.0.0", "ok", true],
    ["null marker", "1.2.0", null, "no-marker", true],
    ["empty-string marker", "1.2.0", "", "no-marker", true],
    ["content behind (patch)", "1.0.1", "1.0.0", "content-behind", true],
    ["content behind (minor)", "1.2.0", "1.1.9", "content-behind", true],
    ["content behind (major, still just upgrade)", "2.0.0", "1.9.9", "content-behind", true],
    ["cli behind (minor, same major)", "1.1.0", "1.4.0", "cli-behind", true],
    ["cli behind (patch, same major)", "1.4.0", "1.4.9", "cli-behind", true],
    ["cli behind boundary 1.0.0 vs 1.9.9", "1.0.0", "1.9.9", "cli-behind", true],
    ["cli behind MAJOR", "1.9.0", "2.0.0", "cli-behind-major", false],
    ["cli behind MAJOR boundary 0.9.9 vs 1.0.0", "0.9.9", "1.0.0", "cli-behind-major", false],
    ["cli behind MAJOR by two", "1.0.0", "3.0.0", "cli-behind-major", false],
    // unparseable versions collapse to [0,0,0]
    ["both garbage → equal", "garbage", "junk", "ok", true],
    ["cli parses, content garbage → content-behind", "1.0.0", "not-a-version", "content-behind", true],
    ["cli garbage, content parses → cli-behind-major", "not-a-version", "1.0.0", "cli-behind-major", false],
  ];
  for (const [name, cli, content, status, ok] of rows) {
    it(`${name} → ${status} (ok=${ok})`, () => {
      const r = checkVersionCompat(cli, content);
      expect(r).to.include({ status, ok });
      expect(r.message).to.be.a("string").and.not.equal("");
    });
  }

  it("messages carry the right guidance per status", () => {
    expect(checkVersionCompat("1.3.0", "1.1.0").message).to.match(/gov upgrade/);
    expect(checkVersionCompat("1.1.0", "1.4.0").message).to.match(/npm i -g @svayam-opensource\/gov@1\.4\.0/);
    expect(checkVersionCompat("1.9.0", "2.0.0").message).to.match(/MAJOR version behind/);
    expect(checkVersionCompat("1.0.0", null).message).to.match(/no content VERSION marker/);
    expect(checkVersionCompat("2.0.0", "2.0.0").message).to.match(/== content/);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// deps
// ════════════════════════════════════════════════════════════════════════════
describe("coverage — checkDeps: platform × tool-presence cartesian", () => {
  const platforms = ["darwin", "linux", "win32", "freebsd"] as const; // last = unknown platform
  const presence: Array<[string, (n: string) => boolean, boolean]> = [
    ["both present", () => true, true],
    ["git only", (n) => n === "git", false],
    ["gh only", (n) => n === "gh", false],
    ["none present", () => false, false],
  ];
  const knownHints: Record<string, Record<string, string>> = {
    darwin: { git: "brew install git", gh: "brew install gh" },
    linux: { git: "apt-get install -y git  (or: dnf install git)", gh: "https://github.com/cli/cli#installation" },
    win32: { git: "winget install Git.Git", gh: "winget install GitHub.cli" },
  };
  for (const platform of platforms)
    for (const [label, hasTool, expectedOk] of presence) {
      it(`${platform} · ${label} → ok=${expectedOk} with correct hints`, () => {
        const r = checkDeps(hasTool, platform);
        expect(r.ok).to.equal(expectedOk);
        expect(r.tools.map((t) => t.name)).to.deep.equal(["git", "gh"]);
        for (const t of r.tools) {
          expect(t.present).to.equal(hasTool(t.name));
          const expectHint = knownHints[platform]?.[t.name] ?? `install ${t.name}`;
          expect(t.installHint).to.equal(expectHint);
        }
        const lines = formatDepsReport(r);
        expect(lines[lines.length - 1]).to.equal(expectedOk ? "deps: all present" : "deps: install the missing tools above");
        for (const t of r.tools) {
          if (t.present) expect(lines.some((l) => l === `  ✓ ${t.name}`)).to.equal(true);
          else expect(lines.some((l) => l === `  ✗ ${t.name} — ${t.installHint}`)).to.equal(true);
        }
      });
    }
});

// ════════════════════════════════════════════════════════════════════════════
// publish gate
// ════════════════════════════════════════════════════════════════════════════
describe("coverage — publishGate: version in-sync vs mismatched vs missing", () => {
  const PKG = "publish/actions/ts/package.json";
  const VER = "publish/content/VERSION";

  it("PASS when CLI version == content VERSION", () => {
    const g = publishGate(memFs({ [PKG]: '{"version":"1.0.0"}', [VER]: "1.0.0" }).fs, "/repo");
    expect(g).to.deep.equal({ ok: true, blockers: [] });
    expect(formatPublishGate(g)[0]).to.match(/PASS/);
  });

  it("BLOCKED (version-sync) when content VERSION drifts", () => {
    const g = publishGate(memFs({ [PKG]: '{"version":"1.0.0"}', [VER]: "0.9.9" }).fs, "/repo");
    expect(g.ok).to.equal(false);
    expect(g.blockers.join()).to.match(/version-sync: publish\/content\/VERSION/);
    const lines = formatPublishGate(g);
    expect(lines[0]).to.match(/BLOCKED/);
    expect(lines.some((l) => /^ {2}- version-sync:/.test(l))).to.equal(true);
  });

  it("BLOCKED when content VERSION is missing entirely", () => {
    const g = publishGate(memFs({ [PKG]: '{"version":"1.0.0"}' }).fs, "/repo");
    expect(g.ok).to.equal(false);
    expect(g.blockers.join()).to.match(/missing/);
  });

  it("PASS (N/A) outside the framework repo — no CLI package.json", () => {
    const g = publishGate(memFs({}).fs, "/repo");
    expect(g).to.deep.equal({ ok: true, blockers: [] });
  });
});

// ════════════════════════════════════════════════════════════════════════════
// bump-version
// ════════════════════════════════════════════════════════════════════════════
describe("coverage — bumpVersion: bumps × lockstep × bad input × fs errors", () => {
  const PKG = "publish/actions/ts/package.json";
  const VER = "publish/content/VERSION";
  const pkgOf = (v: string) => `{\n  "name": "x",\n  "version": "${v}",\n  "type": "module"\n}\n`;

  const bumps: Array<[string, string]> = [
    ["major", "2.0.0"], ["minor", "1.3.0"], ["patch", "1.2.4"],
    ["pre-release", "1.2.3-rc.1"], ["pre-release build", "2.0.0-alpha.0"],
  ];
  for (const [kind, target] of bumps) {
    it(`${kind} bump to ${target}: writes both files in lockstep, preserves package.json formatting`, () => {
      const { fs: f, store } = memFs({ [PKG]: pkgOf("1.2.3") });
      const r = bumpVersion(f, "/repo", target);
      expect(r.ok).to.equal(true);
      if (r.ok) {
        expect(r.version).to.equal(target);
        expect(r.written).to.deep.equal(["publish/actions/ts/package.json", "publish/content/VERSION"]);
      }
      expect(store[PKG]).to.equal(pkgOf(target)); // only the version value changed
      expect(store[VER]).to.equal(`${target}\n`);
    });
  }

  const bad: Array<[string, string]> = [
    ["missing patch", "1.2"], ["dotted word", "latest"], ["v-prefixed", "v1.0.0"],
    ["empty", ""], ["too many parts", "1.2.3.4"], ["leading text", "x1.2.3"],
  ];
  for (const [label, input] of bad) {
    it(`rejects non-version input (${label}='${input}') with code 2 and no writes`, () => {
      const { fs: f, store } = memFs({ [PKG]: pkgOf("1.2.3") });
      const r = bumpVersion(f, "/repo", input);
      expect(r).to.include({ ok: false, code: 2 });
      expect(store[PKG]).to.equal(pkgOf("1.2.3")); // untouched
      expect(store[VER]).to.equal(undefined);
    });
  }

  it("errors (code 1) when package.json is absent", () => {
    const r = bumpVersion(memFs({}).fs, "/repo", "1.0.0");
    expect(r).to.include({ ok: false, code: 1 });
    if (!r.ok) expect(r.error).to.match(/package\.json not found/);
  });

  it("errors (code 1) when package.json has no version field", () => {
    const r = bumpVersion(memFs({ [PKG]: "{}" }).fs, "/repo", "1.0.0");
    expect(r).to.include({ ok: false, code: 1 });
    if (!r.ok) expect(r.error).to.match(/no "version" field/);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// upgrade overlay-sync engine (pure)
// ════════════════════════════════════════════════════════════════════════════
describe("coverage — upgrade overlay-sync: parse/expand/plan/merge/apply cartesian", () => {
  const MANIFEST = `# a comment
version: "1.0.0"
files:
  - { src: VERSION, dst: VERSION, mode: scaffold-auto }
  - { src: CLAUDE.md, dst: CLAUDE.md, mode: scaffold-prompt }
  - { src: knowledge/guidance/, dst: knowledge/guidance/, mode: scaffold-prompt }
  - { src: org-config.example.yaml, dst: org-config.yaml, mode: overlay-schema }
owned:
  - org-config.yaml
  - "projects/PRJ-*/"   # trailing comment
`;

  it("parseManifest: files + owned, ignoring comments/blank/top-level scalars", () => {
    const m = parseManifest(MANIFEST);
    expect(m.files).to.have.lengthOf(4);
    expect(m.files[0]).to.deep.equal({ src: "VERSION", dst: "VERSION", mode: "scaffold-auto" });
    expect(m.files[3]).to.deep.equal({ src: "org-config.example.yaml", dst: "org-config.yaml", mode: "overlay-schema" });
    expect(m.owned).to.deep.equal(["org-config.yaml", "projects/PRJ-*/"]);
  });

  it("parseManifest: empty text → empty manifest", () => {
    expect(parseManifest("")).to.deep.equal({ files: [], owned: [] });
  });

  it("expandEntries: directory entries expand per content file; file entries pass through; no-match dir yields nothing", () => {
    const m = parseManifest(MANIFEST);
    const exp = expandEntries(m, ["knowledge/guidance/a.md", "knowledge/guidance/sub/b.md", "unrelated.md"]);
    const dsts = exp.map((e) => e.dst);
    expect(dsts).to.include.members(["VERSION", "CLAUDE.md", "org-config.yaml"]); // file passthroughs
    expect(dsts).to.include.members(["knowledge/guidance/a.md", "knowledge/guidance/sub/b.md"]);
    expect(dsts).to.not.include("unrelated.md"); // outside the dir prefix
    // a dir entry with no matching content files contributes zero expansions
    const none = expandEntries({ files: [{ src: "x/", dst: "x/", mode: "scaffold-auto" }], owned: [] }, ["y/a"]);
    expect(none).to.have.lengthOf(0);
  });

  // planUpgrade: full cross of mode × adopter state
  it("planUpgrade scaffold-auto: null→create, equal→same, differ→update", () => {
    const entries: ManifestEntry[] = [{ src: "s", dst: "d", mode: "scaffold-auto" }];
    const mk = (adopter: string | null): UpgradePlan => planUpgrade(entries, {
      readContent: () => "NEW", readAdopter: () => adopter, adopterPaths: () => [],
    });
    expect(mk(null).actions[0]).to.deep.include({ kind: "create", dst: "d" });
    expect(mk("NEW").actions[0]).to.include({ kind: "same" });
    expect(mk("OLD").actions[0]).to.include({ kind: "update" });
  });

  it("planUpgrade scaffold-prompt: null→create, equal→same, differ+baseline==current→update, differ+no/other baseline→conflict", () => {
    const entries: ManifestEntry[] = [{ src: "s", dst: "d", mode: "scaffold-prompt" }];
    const base: PlanReaders = { readContent: () => "NEW", readAdopter: () => null, adopterPaths: () => [] };
    expect(planUpgrade(entries, { ...base, readAdopter: () => null }).actions[0].kind).to.equal("create");
    expect(planUpgrade(entries, { ...base, readAdopter: () => "NEW" }).actions[0].kind).to.equal("same");
    // unmodified since last sync (baseline tracks the org copy) → update
    expect(planUpgrade(entries, { ...base, readAdopter: () => "OLDSHIPPED", readBaseline: () => "OLDSHIPPED" }).actions[0])
      .to.deep.include({ kind: "update", detail: "unmodified since last sync" });
    // org-customized (baseline differs) → conflict
    expect(planUpgrade(entries, { ...base, readAdopter: () => "CUSTOM", readBaseline: () => "OLDSHIPPED" }).actions[0].kind).to.equal("conflict");
    // no baseline tracking at all → conflict
    expect(planUpgrade(entries, { ...base, readAdopter: () => "CUSTOM" }).actions[0].kind).to.equal("conflict");
  });

  it("planUpgrade overlay-schema: null→create(seed), present→overlay(merge)", () => {
    const entries: ManifestEntry[] = [{ src: "org-config.example.yaml", dst: "org-config.yaml", mode: "overlay-schema" }];
    const rc = () => 'org_name: ""\n';
    expect(planUpgrade(entries, { readContent: rc, readAdopter: () => null, adopterPaths: () => [] }).actions[0])
      .to.deep.include({ kind: "create", detail: "seed from template" });
    expect(planUpgrade(entries, { readContent: rc, readAdopter: () => 'org_name: "Acme"\n', adopterPaths: () => [] }).actions[0])
      .to.deep.include({ kind: "overlay", detail: "add new keys · comment removed · keep values" });
  });

  it("planUpgrade: a shipped file missing from the content source produces no action", () => {
    const plan = planUpgrade([{ src: "gone", dst: "d", mode: "scaffold-auto" }], {
      readContent: () => null, readAdopter: () => "whatever", adopterPaths: () => [],
    });
    expect(plan.actions).to.have.lengthOf(0);
  });

  it("planUpgrade retire: each RETIRE_PATH prefix/exact matched once (deduped), across a messy adopter", () => {
    const adopterPaths = [
      "framework/agent.md", "framework/sub/x.md", "registry.yaml", ".framework-version",
      "bin/prj", "scripts/setup.sh", "setup.sh", "install.sh", "prj", "src/keep.ts",
    ];
    const plan = planUpgrade([], { readContent: () => null, readAdopter: () => null, adopterPaths: () => adopterPaths });
    const retired = plan.actions.filter((a) => a.kind === "retire").map((a) => a.dst);
    expect(retired).to.have.members([...RETIRE_PATHS]); // every retire path hit, exactly once
    expect(retired).to.have.lengthOf(RETIRE_PATHS.length);
    expect(retired).to.not.include("src/keep.ts");
  });

  // mergeOrgConfig — add / comment / keep
  it("mergeOrgConfig: keeps org values, adds template keys, comments dropped keys, preserves comments/order", () => {
    const template = "# header comment\norg_name: \"\"\norg_short_name: \"\"\ndefault_branch: \"main\"\n";
    const org = "org_name: \"Acme\"\ndefault_branch: \"trunk\"\nlegacy_field: \"old\"\n";
    const merged = mergeOrgConfig(template, org);
    expect(merged).to.match(/# header comment/);              // template comment preserved
    expect(merged).to.match(/org_name: "Acme"/);              // org value kept
    expect(merged).to.match(/org_short_name: ""/);            // new template key added
    expect(merged).to.match(/default_branch: "trunk"/);       // org value wins over template default
    expect(merged).to.match(/# Removed from the framework template/); // dropped-key banner
    expect(merged).to.match(/# legacy_field: "old"/);         // dropped key commented
    expect(merged.endsWith("\n")).to.equal(true);             // single trailing newline
  });

  it("mergeOrgConfig: when org keys are a subset of template, no 'Removed' banner is emitted", () => {
    const merged = mergeOrgConfig("org_name: \"\"\norg_slug: \"\"\n", "org_name: \"Acme\"\n");
    expect(merged).to.match(/org_name: "Acme"/);
    expect(merged).to.not.match(/Removed from the framework template/);
  });

  // applyUpgrade — with / without includeConflicts, every action kind
  function applyHarness(plan: UpgradePlan, opts: { includeConflicts?: boolean }) {
    const content: Record<string, string> = { "vsrc": "V-NEW", "ovsrc": 'org_name: ""\nnew_key: ""\n', "nullsrc": undefined as unknown as string };
    const store: Record<string, string> = { "d-update": "OLD", "org-config.yaml": 'org_name: "Acme"\n' };
    const removed: string[] = [];
    const res = applyUpgrade(plan, {
      readContent: (p) => (p in content ? content[p] ?? null : null),
      readAdopter: (p) => store[p] ?? null,
      writeAdopter: (p, t) => { store[p] = t; },
      removeAdopter: (p) => { removed.push(p); },
    }, opts);
    return { res, store, removed };
  }

  const fullPlan: UpgradePlan = {
    actions: [
      { kind: "create", dst: "d-create", src: "vsrc" },
      { kind: "update", dst: "d-update", src: "vsrc" },
      { kind: "same", dst: "d-same", src: "vsrc" },
      { kind: "conflict", dst: "d-conflict", src: "vsrc" },
      { kind: "overlay", dst: "org-config.yaml", src: "ovsrc" },
      { kind: "retire", dst: "framework/" },
      { kind: "create", dst: "d-nullsrc", src: "nullsrc" },
    ],
  };

  it("applyUpgrade WITHOUT includeConflicts: writes create/update, merges overlay, retires, SKIPS conflict + same + null-src", () => {
    const { res, store, removed } = applyHarness(fullPlan, {});
    expect(store["d-create"]).to.equal("V-NEW");
    expect(store["d-update"]).to.equal("V-NEW");
    expect(store["org-config.yaml"]).to.match(/org_name: "Acme"/); // value kept
    expect(store["org-config.yaml"]).to.match(/new_key: ""/);      // new key added
    expect(removed).to.deep.equal(["framework/"]);
    expect(store["d-conflict"]).to.equal(undefined);               // skipped
    expect(store["d-nullsrc"]).to.equal(undefined);                // src content null → no write
    expect(res.skipped).to.deep.equal(["d-conflict"]);
    expect(res.applied).to.have.members(["d-create", "d-update", "org-config.yaml", "framework/"]);
  });

  it("applyUpgrade WITH includeConflicts: the conflict is written too and not skipped", () => {
    const { res, store } = applyHarness(fullPlan, { includeConflicts: true });
    expect(store["d-conflict"]).to.equal("V-NEW");
    expect(res.skipped).to.deep.equal([]);
    expect(res.applied).to.include("d-conflict");
  });

  it("applyUpgrade overlay with no existing adopter file → seeds the raw template", () => {
    const store: Record<string, string> = {};
    applyUpgrade({ actions: [{ kind: "overlay", dst: "org-config.yaml", src: "t" }] }, {
      readContent: () => 'org_name: ""\n', readAdopter: () => null,
      writeAdopter: (p, t) => { store[p] = t; }, removeAdopter: () => {},
    });
    expect(store["org-config.yaml"]).to.equal('org_name: ""\n');
  });

  it("formatPlan: hides 'same', renders a summary; empty (all-same) plan shows the matched-content notice", () => {
    const lines = formatPlan(fullPlan);
    expect(lines.join("\n")).to.match(/plan:/);
    expect(lines.some((l) => /d-same/.test(l))).to.equal(false); // 'same' filtered out
    const allSame = formatPlan({ actions: [{ kind: "same", dst: "x" }] });
    expect(allSame.some((l) => /already matches the published content/.test(l))).to.equal(true);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// upgrade runner (fs-backed) — dry-run vs --apply, error paths
// ════════════════════════════════════════════════════════════════════════════
describe("coverage — upgrade runner (fs-backed)", () => {
  const MANIFEST = `version: "1.0.0"
files:
  - { src: VERSION, dst: VERSION, mode: scaffold-auto }
  - { src: CLAUDE.md, dst: CLAUDE.md, mode: scaffold-prompt }
`;

  function contentDirWith(): string {
    const c = mkTmp("gov-content-");
    write(c, "MANIFEST.yaml", MANIFEST);
    write(c, "VERSION", "1.0.0\n");
    write(c, "CLAUDE.md", "new claude\n");
    return c;
  }

  it("runUpgradeSync: missing MANIFEST.yaml → code 1", () => {
    const r = runUpgradeSync(mkTmp("gov-content-"), mkTmp("gov-adopter-"), { apply: false });
    expect(r.code).to.equal(1);
    expect(r.lines.join("\n")).to.match(/no MANIFEST\.yaml/);
  });

  it("runUpgradeSync DRY RUN: no writes, reports the plan, tells you to re-run with --apply", () => {
    const content = contentDirWith();
    const adopter = mkTmp("gov-adopter-");
    write(adopter, "VERSION", "0.9.0\n");
    write(adopter, "CLAUDE.md", "customized\n");
    write(adopter, "registry.yaml", "x\n");
    const r = runUpgradeSync(content, adopter, { apply: false });
    expect(r.code).to.equal(0);
    expect(r.lines.join("\n")).to.match(/DRY RUN/);
    expect(r.lines.join("\n")).to.match(/Re-run with --apply/);
    // nothing changed on disk
    expect(fs.readFileSync(path.join(adopter, "VERSION"), "utf8")).to.equal("0.9.0\n");
    expect(fs.existsSync(path.join(adopter, "registry.yaml"))).to.equal(true);
  });

  it("runUpgradeSync --apply: writes updates, retires old-world artifacts, skips org-customized conflicts", () => {
    const content = contentDirWith();
    const adopter = mkTmp("gov-adopter-");
    write(adopter, "VERSION", "0.9.0\n");        // scaffold-auto differs → update
    write(adopter, "CLAUDE.md", "customized\n"); // scaffold-prompt, no baseline → conflict (skipped)
    write(adopter, "registry.yaml", "x\n");      // retire
    const r = runUpgradeSync(content, adopter, { apply: true });
    expect(r.code).to.equal(0);
    expect(r.lines[0]).to.match(/applied \d+ change\(s\).*skipped 1 conflict/);
    expect(fs.readFileSync(path.join(adopter, "VERSION"), "utf8")).to.equal("1.0.0\n"); // updated
    expect(fs.readFileSync(path.join(adopter, "CLAUDE.md"), "utf8")).to.equal("customized\n"); // conflict left intact
    expect(fs.existsSync(path.join(adopter, "registry.yaml"))).to.equal(false); // retired
  });

  it("runUpgradePr: missing MANIFEST.yaml → code 1 (before any git)", () => {
    const r = runUpgradePr(mkTmp("gov-content-"), mkTmp("gov-adopter-"), {});
    expect(r.code).to.equal(1);
    expect(r.lines.join("\n")).to.match(/no MANIFEST\.yaml/);
  });

  it("runUpgradePr: adopter is not a git repository → code 1 (no git mutation)", () => {
    const content = contentDirWith();
    const adopter = mkTmp("gov-adopter-"); // fresh temp dir, not a git repo
    const r = runUpgradePr(content, adopter, {});
    expect(r.code).to.equal(1);
    expect(r.lines.join("\n")).to.match(/not a git repository/);
  });

  (gitOk() ? it : it.skip)("runUpgradePr: dirty working tree → code 1 (commit/stash first)", () => {
    const content = contentDirWith();
    const adopter = mkTmp("gov-adopter-");
    git(adopter, ["init"]);
    write(adopter, "untracked.txt", "dirty\n"); // untracked → porcelain non-empty
    const r = runUpgradePr(content, adopter, {});
    expect(r.code).to.equal(1);
    expect(r.lines.join("\n")).to.match(/uncommitted changes/);
  });

  (gitOk() ? it : it.skip)("runUpgradePr: workspace already matches content → code 0, nothing to do (no branch/push/gh)", () => {
    const content = mkTmp("gov-content-");
    write(content, "MANIFEST.yaml", "version: \"1.0.0\"\nfiles:\n  - { src: VERSION, dst: VERSION, mode: scaffold-auto }\n");
    write(content, "VERSION", "1.0.0\n");
    const adopter = mkTmp("gov-adopter-");
    git(adopter, ["init"]);
    write(adopter, "VERSION", "1.0.0\n"); // identical to content → all 'same', no retires
    git(adopter, ["add", "-A"]);
    git(adopter, ["commit", "-m", "seed"]);
    const r = runUpgradePr(content, adopter, {});
    expect(r.code).to.equal(0);
    expect(r.lines.join("\n")).to.match(/already matches content/);
    // no upgrade branch was created
    const branches = execFileSync("git", ["-C", adopter, "branch", "--list", "gov-upgrade-*"], { encoding: "utf8" });
    expect(branches.trim()).to.equal("");
  });

  (gitOk() ? it : it.skip)("fetchTemplateContent: bad url/path → throws (could not fetch content)", () => {
    expect(() => fetchTemplateContent("/nonexistent/repo/path-xyz.git", "main")).to.throw(/could not fetch content/);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// setup — interactive / non-interactive / existing-config
// ════════════════════════════════════════════════════════════════════════════
describe("coverage — setup: interactive, non-interactive, existing-config, url parsing", () => {
  const CTX = { originUrl: "git@github.com:Acme/acme-gov.git", ghUser: "rk", gitEmail: "rk@acme.io", today: "2026-07-04" };

  function fakeFs(sink: Record<string, string>): Fs {
    return { writeFile: (f, c) => { sink[f] = c; }, pathExists: () => false, readFile: () => null, mkdirp: () => {}, rm: () => {}, readdir: () => [] };
  }

  it("parseOriginOwnerRepo: ssh, https, https+.git, trailing slash, non-github", () => {
    expect(parseOriginOwnerRepo("git@github.com:Acme/acme-gov.git")).to.deep.equal({ owner: "Acme", repo: "acme-gov" });
    expect(parseOriginOwnerRepo("https://github.com/Acme/acme-gov")).to.deep.equal({ owner: "Acme", repo: "acme-gov" });
    expect(parseOriginOwnerRepo("https://github.com/Acme/acme-gov.git")).to.deep.equal({ owner: "Acme", repo: "acme-gov" });
    expect(parseOriginOwnerRepo("https://github.com/Acme/acme-gov/")).to.deep.equal({ owner: "Acme", repo: "acme-gov" });
    expect(parseOriginOwnerRepo("https://gitlab.com/Acme/x")).to.equal(null);
    expect(parseOriginOwnerRepo("not-a-url")).to.equal(null);
  });

  it("deriveOrgConfig: owners default to the policy owner; slug_lower + canonical paths derived", () => {
    const v = deriveOrgConfig({ orgName: "Acme Inc", orgSlug: "ACME" }, CTX);
    expect(v).to.include({
      orgSlugLower: "acme", githubOrg: "Acme", workspaceRepo: "acme-gov",
      agentWorkRoot: "~/.acme/projects", govWorkspace: "~/.acme/gov_repo",
      policyOwnerGithub: "@rk", legalOwnerGithub: "@rk", infraOwnerGithub: "@rk",
      systemArchOwnerGithub: "@rk", dataArchOwnerGithub: "@rk",
    });
  });

  it("deriveOrgConfig: no ghUser/gitEmail → empty owner/email defaults", () => {
    const v = deriveOrgConfig({ orgName: "X", orgSlug: "XX" }, { originUrl: "not-a-url", ghUser: null, gitEmail: null, today: "2026-07-04" });
    expect(v.policyOwnerGithub).to.equal("");
    expect(v.policyOwnerEmail).to.equal("");
    expect(v.githubOrg).to.equal(""); // origin unparseable
  });

  it("readExistingOrgConfig round-trips a rendered config's scalars", () => {
    const yaml = renderOrgConfig(deriveOrgConfig({ orgName: "Acme Inc", orgShortName: "Acme", orgSlug: "ACME" }, CTX));
    expect(readExistingOrgConfig(yaml)).to.include({ orgName: "Acme Inc", orgSlug: "ACME" });
    expect(yaml).to.not.match(/^gov_workspace:/m);   // dropped from the rendered config
  });

  it("runSetup interactive: scripted answers → writes config, prints derived origin fields + next steps, sets remote", async () => {
    const writes: Record<string, string> = {};
    const printed: string[] = [];
    let remote = "";
    const answers: Record<string, string> = {
      "Full legal name of your organization": "Acme Inc",
      "Org slug (uppercase, 2-6 chars; e.g. ACME)": "ACME",
      "Default base branch for code repositories": "trunk",
    };
    const code = await runSetup({
      fs: fakeFs(writes), cwd: "/repo", ...CTX, ghUser: "rk", gitEmail: "rk@acme.io",
      prompt: async (q, def) => answers[q] ?? def,
      print: (l) => printed.push(l),
      setOriginRemote: (u) => { remote = u; },
    }, true);
    expect(code).to.equal(0);
    expect(pxKeys(writes)["/repo/org-config.yaml"]).to.match(/org_name: "Acme Inc"/);
    expect(pxKeys(writes)["/repo/org-config.yaml"]).to.match(/default_code_branch: "trunk"/); // answer honored
    expect(printed.some((l) => /github_org:.*Acme.*from origin/.test(l))).to.equal(true);
    expect(printed.some((l) => /gov org use Acme/.test(l))).to.equal(true);

    // REGRESSION: setup once printed `gov org add <org> <path>` — a form its OWN parser rejects
    // (usage is `add <github_org> --home <path>`), so the first command a new adopter was told to
    // run could not work. Any `gov org add` we print must carry --home.
    const addLine = printed.find((l) => l.includes("gov org add"));
    expect(addLine, "setup should print a `gov org add` hint").to.be.a("string");
    expect(addLine).to.match(/gov org add \S+ --home \S+/);
    // ...and it must point at the directory setup RAN IN — `gov org add` refuses a home without an
    // org-config.yaml, which is exactly what the retired ~/<slug>/gov_repo hint sent people to.
    // Asserted against the cwd the fixture supplied, NOT re-derived from the written path:
    // path.join normalises separators, so on Windows the config path is `\repo\...` while the hint
    // carries the cwd verbatim. Comparing two derivations tests Node's path module, not our output.
    expect(addLine).to.include("--home /repo");
    expect(Object.keys(writes).some((f) => f.endsWith("org-config.yaml"))).to.equal(true);
    expect(remote).to.equal("git@github.com:Acme/acme-gov.git");
  });

  it("runSetup non-interactive with existing config → succeeds without prompting", async () => {
    const writes: Record<string, string> = {};
    let prompted = false;
    const existing: Partial<OrgConfigValues> = { orgName: "Existing Co", orgSlug: "EXCO" };
    const code = await runSetup({
      fs: fakeFs(writes), cwd: "/repo", ...CTX, existing,
      prompt: async (_q, d) => { prompted = true; return d; },
      print: () => {},
    }, false);
    expect(code).to.equal(0);
    expect(prompted).to.equal(false);
    expect(pxKeys(writes)["/repo/org-config.yaml"]).to.match(/org_name: "Existing Co"/);
  });

  it("runSetup non-interactive missing required (no existing) → code 1, prints guidance", async () => {
    const printed: string[] = [];
    const code = await runSetup({
      fs: fakeFs({}), cwd: "/repo", originUrl: CTX.originUrl, ghUser: null, gitEmail: null, today: "2026-07-04",
      prompt: async (_q, d) => d, print: (l) => printed.push(l),
    }, false);
    expect(code).to.equal(1);
    expect(printed.some((l) => /org_name and org_slug are required/.test(l))).to.equal(true);
  });

  it("runSetup: no setOriginRemote injected → still succeeds, no throw", async () => {
    const writes: Record<string, string> = {};
    const code = await runSetup({
      fs: fakeFs(writes), cwd: "/repo", ...CTX, existing: { orgName: "Y", orgSlug: "YY" },
      prompt: async (_q, d) => d, print: () => {},
    }, false);
    expect(code).to.equal(0);
    expect(pxKeys(writes)["/repo/org-config.yaml"]).to.match(/org_name: "Y"/);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// validate suite — passing + failing fixtures across all validators
// ════════════════════════════════════════════════════════════════════════════
describe("coverage — validate suite over a fake fs (pass + fail per validator)", () => {
  const PKG = "publish/actions/ts/package.json";
  const VER = "publish/content/VERSION";
  const FM = "---\ndomain: policies\nlayer: mandate\ncompliance: C01\nstatus: current\nowner: rkant\n---\n";
  const PROTO = "§0: the agent speaks first, posts the context manifest before you change any code.";

  /** A fully-green workspace for the CORE suite. */
  const greenFiles = (): Record<string, string> => ({
    [PKG]: '{"version":"1.0.0"}',
    [VER]: "1.0.0\n",
    "agent/session-protocol.md": PROTO,
    "knowledge/policies/README.md": `${FM}\n[foo](foo.md)\n`,
    "knowledge/policies/foo.md": `${FM}\n# Foo policy\n`,
  });

  it("all-green workspace → runSuite ok, no failures (all 5 core validators pass)", () => {
    const r = runSuite(workspaceCtx(greenFiles()));
    expect(r).to.deep.equal({ ok: true, failures: [] });
    // and the aggregated run reports 4 passing results
    const run = runValidators(workspaceCtx(greenFiles()), CORE_VALIDATORS);
    expect(run.results).to.have.lengthOf(5);
    expect(run.results.every((x) => x.ok)).to.equal(true);
  });

  it("breaking version-sync (content drift) surfaces a version-sync failure", () => {
    const f = greenFiles(); f[VER] = "9.9.9\n";
    const r = runSuite(workspaceCtx(f));
    expect(r.ok).to.equal(false);
    expect(r.failures.some((x) => /^version-sync:/.test(x))).to.equal(true);
  });

  it("breaking secrets (hardcoded credential) surfaces a secrets failure", () => {
    const f = greenFiles(); f["config.yaml"] = 'password: "s3cr3t-real-value"\n';
    const r = runSuite(workspaceCtx(f));
    expect(r.ok).to.equal(false);
    expect(r.failures.some((x) => /^secrets:/.test(x))).to.equal(true);
  });

  it("breaking protocol (gutted §0 mandate) surfaces a protocol failure", () => {
    const f = greenFiles(); f["agent/session-protocol.md"] = "some unrelated prose";
    const r = runSuite(workspaceCtx(f));
    expect(r.ok).to.equal(false);
    expect(r.failures.some((x) => /^protocol:/.test(x))).to.equal(true);
  });

  it("breaking knowledge (orphan doc) surfaces a knowledge failure", () => {
    const f = greenFiles();
    f["knowledge/policies/orphan.md"] = `${FM}\n# nobody links me\n`;
    const r = runSuite(workspaceCtx(f));
    expect(r.ok).to.equal(false);
    expect(r.failures.some((x) => /^knowledge:.*orphan/.test(x))).to.equal(true);
  });

  it("privacy validator (publish-only): passes clean content, flags a leaked org value", () => {
    const MAIN = 'org_name: "Svayam Infoware Pvt"\ngithub_org: "Svayamtech"\npolicy_owner_email: "rkant@svayam.ai"\n';
    const v = makePrivacyValidator(MAIN);
    expect(v(workspaceCtx({ "docs/clean.md": "nothing sensitive here\n" })).ok).to.equal(true);
    const leak = v(workspaceCtx({ "docs/guide.md": "clone git@github.com:Svayamtech/x\n" }));
    expect(leak.ok).to.equal(false);
    expect(leak.errors.some((e) => /leak of github_org='Svayamtech'/.test(e))).to.equal(true);
  });

  it("privacy validator: unconfigured main (no org-specific values) → always passes", () => {
    const v = makePrivacyValidator("default_branch: main\n");
    expect(v(workspaceCtx({ "docs/x.md": "anything at all" }))).to.deep.equal({ name: "privacy", ok: true, errors: [] });
  });

  it("CORE_VALIDATORS excludes privacy (it is publish-branch only)", () => {
    const run = runValidators(workspaceCtx(greenFiles()), CORE_VALIDATORS);
    expect(run.results.map((r) => r.name)).to.not.include("privacy");
    expect(run.results.map((r) => r.name)).to.have.members(["version-sync", "secrets", "protocol", "knowledge", "project-knowledge"]);
  });
});

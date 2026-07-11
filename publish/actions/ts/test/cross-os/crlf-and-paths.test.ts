// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * Cross-OS invariants — the behaviours that differ between Windows and POSIX
 * (line endings, path separators). These run on EVERY CI platform, but they also
 * assert the handling directly so a regression is caught regardless of runner.
 */
import { expect } from "chai";
import { parseManifest, expandEntries, mergeOrgConfig, planUpgrade, RETIRE_PATHS } from "../../src/maintain/upgrade-sync.js";
import { parseOrgConfig } from "../../src/config/org-config.js";
import { checkKnowledge } from "../../src/governance/knowledge.js";

describe("cross-OS — CRLF line endings", () => {
  it("parseManifest tolerates CRLF", () => {
    const m = parseManifest("version: \"1.0.0\"\r\nfiles:\r\n  - { src: A.md, dst: A.md, mode: scaffold-auto }\r\nowned:\r\n  - org-config.yaml\r\n");
    expect(m.files[0]).to.deep.equal({ src: "A.md", dst: "A.md", mode: "scaffold-auto" });
    expect(m.owned).to.include("org-config.yaml");
  });

  it("mergeOrgConfig on a CRLF org-config keeps clean values + emits LF", () => {
    const merged = mergeOrgConfig('org_name: ""\norg_short_name: ""\n', 'org_name: "Acme"\r\nlegacy: "x"\r\n');
    expect(merged).to.match(/org_name: "Acme"/);
    expect(merged).to.match(/org_short_name: ""/);
    expect(merged).to.match(/# legacy: "x"/);
    expect(merged).to.not.match(/\r/); // no carriage returns leak through
  });

  it("parseOrgConfig tolerates CRLF (no trailing \\r in values)", () => {
    const c = parseOrgConfig('github_org: "Svayamtech"\r\nworkspace_repo: "svm"\r\ndefault_branch: "main"\r\n');
    expect(c.githubOrg).to.equal("Svayamtech");
    expect(c.defaultBranch).to.equal("main");
  });

  it("a governance validator handles CRLF content", () => {
    // checkKnowledge scans knowledge text; CRLF must not change its verdict.
    const lf = checkKnowledge({ fs: { readFile: () => "# Title\n\ncontent\n", pathExists: () => true, mkdirp() {}, writeFile() {}, rm() {}, readdir: () => [] }, repoRoot: "/r", files: ["knowledge/x.md"] });
    const crlf = checkKnowledge({ fs: { readFile: () => "# Title\r\n\r\ncontent\r\n", pathExists: () => true, mkdirp() {}, writeFile() {}, rm() {}, readdir: () => [] }, repoRoot: "/r", files: ["knowledge/x.md"] });
    expect(crlf.ok).to.equal(lf.ok);
  });
});

describe("cross-OS — path separators (POSIX-relative, Windows-safe)", () => {
  it("MANIFEST dst + RETIRE prefixes are POSIX (/) — matched consistently by the planner", () => {
    // The engine compares /-joined relatives; on Windows path.join still accepts them.
    expect(RETIRE_PATHS.every((p) => !p.includes("\\"))).to.equal(true);
    const entries = expandEntries(parseManifest("files:\n  - { src: knowledge/, dst: knowledge/, mode: scaffold-prompt }\n"), ["knowledge/policies/p.md", "knowledge/sub/dir/q.md"]);
    expect(entries.map((e) => e.dst)).to.deep.equal(["knowledge/policies/p.md", "knowledge/sub/dir/q.md"]);
  });

  it("retire matching works on /-joined adopter paths (as produced by the walker)", () => {
    const plan = planUpgrade([], {
      readContent: () => null,
      readAdopter: () => null,
      adopterPaths: () => ["framework/agent.md", "framework/knowledge/x.md", "registry.yaml", ".framework-version", "keep/me.md"],
    });
    const retired = plan.actions.filter((a) => a.kind === "retire").map((a) => a.dst);
    expect(retired).to.have.members(["framework/", "registry.yaml", ".framework-version"]);
  });
});

import { configDir } from "../../src/resolve/node-env.js";

describe("cross-OS — config dir is OS-idiomatic", () => {
  it("Windows → %APPDATA%\\prj (falls back to AppData/Roaming)", () => {
    expect(configDir({ APPDATA: "C:\\Users\\rk\\AppData\\Roaming" } as NodeJS.ProcessEnv, "win32", "C:\\Users\\rk")).to.match(/AppData[\\/]Roaming[\\/]prj$/);
    expect(configDir({} as NodeJS.ProcessEnv, "win32", "C:\\Users\\rk")).to.match(/AppData[\\/]Roaming[\\/]prj$/);
  });
  it("Linux/macOS → $XDG_CONFIG_HOME/prj, else ~/.config/prj", () => {
    expect(configDir({ XDG_CONFIG_HOME: "/x/cfg" } as NodeJS.ProcessEnv, "linux", "/home/rk")).to.equal("/x/cfg/prj");
    expect(configDir({} as NodeJS.ProcessEnv, "darwin", "/Users/rk")).to.equal("/Users/rk/.config/prj");
    expect(configDir({} as NodeJS.ProcessEnv, "linux", "/home/rk")).to.equal("/home/rk/.config/prj");
  });
});

import { configDir } from "../../src/resolve/node-env.js";

describe("cross-OS — config dir is OS-idiomatic", () => {
  it("Windows → %APPDATA%\\prj (falls back to AppData/Roaming)", () => {
    expect(configDir({ APPDATA: "C:\\Users\\rk\\AppData\\Roaming" } as NodeJS.ProcessEnv, "win32", "C:\\Users\\rk")).to.match(/AppData[\\/]Roaming[\\/]prj$/);
    expect(configDir({} as NodeJS.ProcessEnv, "win32", "C:\\Users\\rk")).to.match(/AppData[\\/]Roaming[\\/]prj$/);
  });
  it("Linux/macOS → $XDG_CONFIG_HOME/prj, else ~/.config/prj", () => {
    expect(configDir({ XDG_CONFIG_HOME: "/x/cfg" } as NodeJS.ProcessEnv, "linux", "/home/rk")).to.equal("/x/cfg/prj");
    expect(configDir({} as NodeJS.ProcessEnv, "darwin", "/Users/rk")).to.equal("/Users/rk/.config/prj");
    expect(configDir({} as NodeJS.ProcessEnv, "linux", "/home/rk")).to.equal("/home/rk/.config/prj");
  });
});

// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * NO TWO PATHS DIFFER ONLY BY LETTER CASE (Policy Owner, 2026-10-07).
 *
 * macOS (APFS) and Windows (NTFS) treat `policies/VERSION` and `policies/version/` as ONE name. A checkout can make
 * only one of them; the other silently vanishes, and `git commit -a` then records it deleted. The sandbox hit
 * exactly this on a Mac, with the frozen snapshots in `policies/version/` beside the file `policies/VERSION`.
 *
 * The guard is against the whole class, over everything that ends up in an organization's repository together:
 *   (a) the content tree gov ships, and every place the MANIFEST puts it;
 *   (b) every path gov itself writes into that repository.
 * Each path counts with every folder above it, so a file and a folder can collide as well as two files.
 *
 * The content tree is read from git's index where there is one, not from the disk: on a case-insensitive disk the
 * collision is exactly what the disk cannot show.
 */
import { expect } from "chai";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { parseManifest, expandEntries } from "../../src/maintain/upgrade-sync.js";
import { MOVES_FILE } from "../../src/maintain/upgrade-run.js";
import { RULE_STORE_PATHS } from "../../src/rules/model/store-io.js";
import { POLICY_PR_PATHS } from "../../src/rules/policy-pr/gate.js";
import { POLICY_HISTORY_DIR, LEGACY_POLICY_HISTORY_DIR, MACHINE_WRITTEN_POLICY_PATHS } from "../../src/rules/checks/policy-actions.js";
import { OWNERSHIP_PATH } from "../../src/rules/checks/ownership.js";
import { GOVERNANCE_PATH } from "../../src/config/governance.js";
import { ROLE_LIST_PATH } from "../../src/config/role-list.js";
import { ORG_CONFIG_SCHEMA_PATH } from "../../src/config/org-config.js";
import { EXCEPTIONS_DIR } from "../../src/rules/exceptions-io.js";
import { HARNESS_DIR, RULE_MAP_PATH } from "../../src/rules/rules-build.js";
import { HARNESS_TARGETS } from "../../src/rules/harness-render.js";
import { ROOT_HARNESS_FILES } from "../../src/lifecycle/root-protocol.js";
import { GOVERNING_FILES } from "../../src/lifecycle/governance-snapshot.js";
import { WORKFLOW_PATH } from "../../src/rules/checks/render-github.js";
import { POL_ALIASES_PATH } from "../../src/rules/model/pol-aliases.js";

const contentDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../content");

/** Every pair of spellings, among the paths and the folders above them, that are one name to a case-insensitive disk. */
function caseCollisions(paths: Iterable<string>): string[][] {
  const spellings = new Map<string, Set<string>>();
  for (const p of paths) {
    const parts = p.replace(/\/+$/, "").split("/").filter(Boolean);
    for (let i = 1; i <= parts.length; i++) {
      const s = parts.slice(0, i).join("/");
      const k = s.toLowerCase();
      if (!spellings.has(k)) spellings.set(k, new Set());
      spellings.get(k)!.add(s);
    }
  }
  return [...spellings.values()].filter((s) => s.size > 1).map((s) => [...s].sort()).sort();
}

function contentFiles(): string[] {
  try {
    const out = execFileSync("git", ["-C", contentDir, "ls-files", "-z", "--", "."], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    const files = out.split("\0").filter(Boolean);
    if (files.length) return files;
  } catch { /* not a git checkout (a packed tarball): the disk is all there is */ }
  const walk = (rel: string): string[] => fs.readdirSync(path.join(contentDir, rel), { withFileTypes: true })
    .flatMap((d) => (d.isDirectory() ? walk(path.join(rel, d.name)) : [path.join(rel, d.name)]))
    .map((p) => p.split(path.sep).join("/"));
  return walk("");
}

describe("no two paths differ only by letter case (macOS and Windows see them as one)", () => {
  it("the check itself: a file and a folder of one name collide, as do two files; distinct names do not", () => {
    expect(caseCollisions(["policies/VERSION", "policies/version/1.0.0/a.md"])).to.deep.equal([["policies/VERSION", "policies/version"]]);
    expect(caseCollisions(["README.md", "readme.md"])).to.deep.equal([["README.md", "readme.md"]]);
    expect(caseCollisions(["policies/VERSION", "policies/history/1.0.0/VERSION", "agent/agent.md", "agent/AGENTS.md"])).to.deep.equal([]);
  });

  const manifest = parseManifest(fs.readFileSync(path.join(contentDir, "MANIFEST.yaml"), "utf8"));
  const shipped = contentFiles();

  /** (a) The content tree, where the MANIFEST puts it, and where its moves land. Never `from:` — the old layout. */
  const contentPaths = (): string[] => [
    ...shipped,
    ...expandEntries(manifest, shipped).map((e) => e.dst),
    ...manifest.moves.map((m) => m.to),
  ];

  /** (b) What gov itself writes into an organization's repository. */
  const govWrites = (): string[] => {
    const policies = shipped.filter((f) => f.startsWith("policies/")).map((f) => f.slice("policies/".length));
    const snapshot = (v: string) => policies.map((f) => `${POLICY_HISTORY_DIR}/${v}/${f}`);
    return [
      ...Object.values(RULE_STORE_PATHS), ...Object.values(POLICY_PR_PATHS),
      ...MACHINE_WRITTEN_POLICY_PATHS.map((g) => g.replace(/\/\*\*$/, "")).filter((p) => p !== LEGACY_POLICY_HISTORY_DIR),
      OWNERSHIP_PATH, GOVERNANCE_PATH, ROLE_LIST_PATH, ORG_CONFIG_SCHEMA_PATH, EXCEPTIONS_DIR, POL_ALIASES_PATH,
      ...snapshot("1.0.0"), ...snapshot("1.10.2"),                            // a frozen snapshot is all of policies/
      RULE_MAP_PATH, ...HARNESS_TARGETS.map((t) => `${HARNESS_DIR}/${t.path}`), // the rendered harness, canonical copies
      ...HARNESS_TARGETS.map((t) => t.path), ...ROOT_HARNESS_FILES,             // ... and at the repository root
      ...HARNESS_TARGETS.map((t) => `projects/PRJ-1-x/${t.path}`),              // ... and in a project
      "projects/PRJ-1-x/agent.md", "projects/PRJ-1-x/knowledge/todo.md",       // a seeded project
      ...GOVERNING_FILES.map((f) => `projects/PRJ-1-x/.gov/governance/${path.posix.basename(f)}`), "projects/PRJ-1-x/.gov/governance/SOURCE",
      WORKFLOW_PATH, "CODEOWNERS", MOVES_FILE, "org-config.yaml", "VERSION",
    ];
  };

  it("(a) the shipped content tree and every MANIFEST destination", () => {
    expect(caseCollisions(contentPaths())).to.deep.equal([]);
  });

  it("(b) the paths gov itself writes, alongside everything it ships", () => {
    expect(caseCollisions([...contentPaths(), ...govWrites()])).to.deep.equal([]);
  });

  it("the old snapshot folder is exactly the collision this guards against", () => {
    expect(caseCollisions([RULE_STORE_PATHS.orgVersion, `${LEGACY_POLICY_HISTORY_DIR}/1.0.0/org-policy.md`]))
      .to.deep.equal([[RULE_STORE_PATHS.orgVersion, LEGACY_POLICY_HISTORY_DIR]]);
  });
});

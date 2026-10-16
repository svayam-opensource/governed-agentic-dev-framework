// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * WHY A HOME IS "NOT A GOV REPO" — missing, unreadable, or readable-but-invalid (adoption walk #12, 2026-10-07).
 *
 * After an upgrade blanked org-config.yaml (#13), the resolver said "that path is not a gov repo (no
 * org-config.yaml)" about a folder whose org-config.yaml was RIGHT THERE. Each of the three states has its own
 * cause and its own fix, so each gets its own sentence.
 */
import { expect } from "chai";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { createNodeEnv } from "../../src/resolve/node-env.js";
import { prjResolveGov, resolveFailureMessage } from "../../src/resolve/resolve-gov.js";
import { orgAdd } from "../../src/resolve/org.js";
import type { ResolveEnv, ResolveResult } from "../../src/resolve/types.js";
import type { RegistryStore } from "../../src/resolve/registry-store.js";

const tmp = (p: string): string => fs.mkdtempSync(path.join(os.tmpdir(), p));
const BLANK = 'org_name: ""\norg_short_name: ""\norg_slug: ""\norg_repo_url: ""\ngithub_org: ""\norg_gov_repo: ""\ndefault_branch: "main"\ndefault_code_branch: "dev"\n';

function failureFor(home: string): Extract<ResolveResult, { ok: false }> {
  const env = createNodeEnv({ cwd: tmp("cfgstate-cwd-"), configDir: tmp("cfgstate-reg-"), home: tmp("cfgstate-home-") });
  const fake: ResolveEnv = { ...env, readActiveOrg: () => "svm-geneva", homeForOrg: () => home, govConfigAt: (p) => env.govConfigAt(p), diagnoseConfigAt: (p) => env.diagnoseConfigAt!(p), parentOf: () => null };
  const r = prjResolveGov(fake, "GOVERNANCE");
  if (r.ok) throw new Error("expected a failure");
  return r;
}

describe("the resolver names WHY a home's org-config.yaml cannot be used", () => {
  it("missing: says there is no org-config.yaml, and how to get it back", () => {
    const home = tmp("cfgstate-missing-");
    const r = failureFor(home);
    expect(r.reason).to.equal("pointer-mismatch");
    const msg = resolveFailureMessage(r);
    expect(msg).to.match(/no org-config\.yaml/);
    expect(msg).to.include(`git -C ${home} checkout -- org-config.yaml`);
  });

  it("the FOLDER gone: says so, and never advises a git checkout inside a folder that does not exist", () => {
    const home = path.join(tmp("cfgstate-gone-"), "deleted-by-a-test");
    const msg = resolveFailureMessage(failureFor(home));
    expect(msg).to.include("that folder no longer exists");
    expect(msg).to.not.include("checkout");
    expect(msg).to.include("gov org remove svm-geneva");
  });

  it("readable but invalid (the blank template an upgrade left): names the empty keys, never says the file is missing", () => {
    const home = tmp("cfgstate-blank-");
    fs.writeFileSync(path.join(home, "org-config.yaml"), BLANK);
    const msg = resolveFailureMessage(failureFor(home));
    expect(msg).to.not.match(/no org-config\.yaml/);
    expect(msg).to.match(/org-config\.yaml is there/);
    for (const k of ["github_org", "org_name", "org_slug"]) expect(msg).to.include(k);
    expect(msg, "the restore-from-history fix").to.include(`git -C ${home} log -p -- org-config.yaml`);
  });

  it("readable but not YAML gov can read: says so, with the parser's reason", () => {
    const home = tmp("cfgstate-bad-");
    fs.writeFileSync(path.join(home, "org-config.yaml"), "org_name: \"Geneva\n  github_org: [\n");
    const msg = resolveFailureMessage(failureFor(home));
    expect(msg).to.not.match(/no org-config\.yaml/);
    expect(msg).to.match(/not valid YAML/);
  });

  const canChmod = process.platform !== "win32" && process.getuid?.() !== 0;
  (canChmod ? it : it.skip)("unreadable: says the file exists but cannot be read, and the permission fix", () => {
    const home = tmp("cfgstate-perm-");
    const f = path.join(home, "org-config.yaml");
    fs.writeFileSync(f, 'github_org: "svm-geneva"\n');
    fs.chmodSync(f, 0o000);
    try {
      const msg = resolveFailureMessage(failureFor(home));
      expect(msg).to.not.match(/no org-config\.yaml/);
      expect(msg).to.match(/could not be read/);
      expect(msg).to.include("EACCES");
      expect(msg).to.include(`chmod u+r ${f}`);
    } finally { fs.chmodSync(f, 0o644); }
  });

  it("an env without the diagnosis keeps the old answer (not-a-gov-repo)", () => {
    const fake: ResolveEnv = { cwd: "/", parentOf: () => null, govConfigAt: () => null, readActiveOrg: () => "o", homeForOrg: () => "/h", sameHome: (a, b) => a === b };
    const r = prjResolveGov(fake, "GOVERNANCE");
    expect(!r.ok && r.reason === "pointer-mismatch" && r.detail.why).to.equal("not-a-gov-repo");
  });

  it("gov org add says the same thing about a blank org-config.yaml", () => {
    const home = tmp("cfgstate-add-");
    fs.writeFileSync(path.join(home, "org-config.yaml"), BLANK);
    const env = createNodeEnv({ cwd: home, configDir: tmp("cfgstate-reg-"), home: tmp("cfgstate-home-") });
    const store = { readHomes: () => [], writeHomes: () => {}, readActiveOrg: () => null, writeActiveOrg: () => {}, clearActiveOrg: () => {} } as unknown as RegistryStore;
    const r = orgAdd({ store, govConfigAt: (p) => env.govConfigAt(p), diagnoseConfigAt: (p) => env.diagnoseConfigAt!(p) }, "svm-geneva", home);
    expect(r.ok).to.equal(false);
    const msg = r.ok ? "" : r.message;
    expect(msg).to.not.match(/no org-config\.yaml/);
    expect(msg).to.include("github_org");
  });
});

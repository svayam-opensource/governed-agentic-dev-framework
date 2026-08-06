// SPDX-License-Identifier: MIT
/**
 * `gov-core` — the things three clients must agree about.
 *
 * These tests are written from the failures that made the package necessary, not from its exports: each one
 * pins a place where two independent copies of a rule disagreed, or could.
 */
import { expect } from "chai";
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  authPath, currentIdentityPath, readCurrentIdentity, saveSession, loadSession, sessionIdentity,
  credentialsPath, setCredential, getCredential, listCredentialKeys, parseCredentials,
  computeGap, type Need, type NeedProbes,
  parseOrgConfig, expandTilde, readTopLevelScalar,
  detectContext, contextFingerprint,
} from "../src/index.js";

const root = () => mkdtempSync(join(tmpdir(), "gov-core-"));
const tokens = { accessToken: "AAA", idToken: "III", refreshToken: "RRR", expiresAt: 1893456000 };

describe("gov-core · identity", () => {
  // #45: the host wrote preferences/<os-user>/gov-auth.json as {accessToken,idToken,expiresAt}; the plugin
  // read preferences/<email>/gov-auth.json expecting {token,user}. A login could not authenticate a
  // governed verb BY CONSTRUCTION. One writer + one reader is the only fix that cannot drift back.
  it("writes a session one reader-convention CANNOT miss — both key and schema", () => {
    const r = root();
    const file = saveSession(r, "rkant@svayam.ai", tokens);
    expect(file).to.equal(authPath(r, "rkant@svayam.ai"));

    const onDisk = JSON.parse(readFileSync(file, "utf8"));
    expect(onDisk.user, "the gov-cicd convention").to.equal("rkant@svayam.ai");
    expect(onDisk.token, "the gov-cicd convention").to.equal("AAA");
    expect(onDisk.accessToken, "the host convention").to.equal("AAA");
    expect(onDisk.expiresAt, "the host convention").to.equal(1893456000);
  });

  it("saving a session ALWAYS moves the pointer — it can never name a session that was not written", () => {
    const r = root();
    saveSession(r, "rkant@svayam.ai", tokens);
    expect(readCurrentIdentity(r)).to.equal("rkant@svayam.ai");
    expect(currentIdentityPath(r)).to.contain("preferences");
    expect(loadSession(r, {} as NodeJS.ProcessEnv)?.token).to.equal("AAA");
  });

  it("resolves the identity in one order: GOV_IDENTITY → .current → OS user", () => {
    const r = root();
    expect(sessionIdentity(r, { GOV_IDENTITY: "explicit@x", USER: "os" } as NodeJS.ProcessEnv)).to.equal("explicit@x");
    saveSession(r, "pointed@x", tokens);
    expect(sessionIdentity(r, { USER: "os" } as NodeJS.ProcessEnv)).to.equal("pointed@x");
    // the migration fallback: a session written before the pointer existed still resolves
    expect(sessionIdentity(root(), { USER: "os" } as NodeJS.ProcessEnv)).to.equal("os");
  });

  it("a missing session is null, never a throw — the caller decides what to do about it", () => {
    expect(loadSession(root(), {} as NodeJS.ProcessEnv)).to.equal(null);
  });
});

describe("gov-core · secrets", () => {
  it("stores a credential as KEY=VALUE, replaces in place, and never returns values from a listing", () => {
    const f = credentialsPath(root(), "rkant@svayam.ai");
    setCredential(f, "npm_token:npm.example.com", "tok-1");
    setCredential(f, "gh_token", "gh-1");
    setCredential(f, "npm_token:npm.example.com", "tok-2");     // replace, not append
    expect(getCredential(f, "npm_token:npm.example.com")).to.equal("tok-2");
    expect(listCredentialKeys(f).sort()).to.deep.equal(["gh_token", "npm_token:npm.example.com"]);
    expect(listCredentialKeys(f).join(" "), "a key listing must never leak a value").to.not.contain("tok-2");
  });

  it("a value containing '=' survives the round trip", () => {
    const parsed = parseCredentials("k=a=b=c\n# comment\n\nbad line\n");
    expect(parsed.get("k")).to.equal("a=b=c");
    expect(parsed.size, "comments and malformed lines are skipped, not guessed at").to.equal(1);
  });

  it("the GAP is the unmet subset, in declared order", () => {
    const probes: NeedProbes = { gitConfig: (k) => (k === "user.name" ? "R" : undefined), ghAuthOk: () => false, hasCred: (k) => k === "have" };
    const needs: Need[] = [
      { id: "a", title: "a", instructions: "", satisfied: (p) => p.hasCred("have") },
      { id: "b", title: "b", instructions: "", satisfied: (p) => p.ghAuthOk() },
      { id: "c", title: "c", instructions: "", satisfied: (p) => !!p.gitConfig("user.email") },
    ];
    expect(computeGap(needs, probes).map((n) => n.id)).to.deep.equal(["b", "c"]);
  });
});

describe("gov-core · location", () => {
  // The mode decides which BRANCH a client reads and writes — project branch vs main. Two clients
  // disagreeing about it means two clients acting on different repositories while reporting the same thing.
  const facts = { govHome: "/g", agentWorkRoot: "/w/projects" };

  it("PROJECT when the cwd is under agent_work_root — at any depth", () => {
    expect(detectContext({ ...facts, cwd: "/w/projects/PRJ-43-gov/svm-prj-work/src" }))
      .to.deep.equal({ mode: "project", projectPath: "PRJ-43-gov" });
  });

  it("GOVERNED elsewhere with a gov home, NONE without one", () => {
    expect(detectContext({ ...facts, cwd: "/somewhere/else" }).mode).to.equal("governed");
    expect(detectContext({ cwd: "/somewhere/else" }).mode).to.equal("none");
  });

  it("agent_work_root itself is not a project, and a sibling path that merely SHARES A PREFIX is not either", () => {
    expect(detectContext({ ...facts, cwd: "/w/projects" }).mode).to.equal("governed");
    // '/w/projects-old' starts with '/w/projects' as a STRING — the separator is what makes it a child
    expect(detectContext({ ...facts, cwd: "/w/projects-old/thing" }).mode).to.equal("governed");
  });

  it("a trailing separator on agent_work_root changes nothing", () => {
    expect(detectContext({ ...facts, agentWorkRoot: "/w/projects/", cwd: "/w/projects/PRJ-43/x" }).projectPath).to.equal("PRJ-43");
  });

  it("reads TOP-LEVEL scalars only — an indented key of the same name is a different key", () => {
    const yaml = "org_name: \"Svayam Infoware Pvt\"  # legal name\nnested:\n  org_name: wrong\nagent_work_root: '~/.svm/projects'\n";
    expect(readTopLevelScalar(yaml, "org_name")).to.equal("Svayam Infoware Pvt");
    expect(readTopLevelScalar(yaml, "agent_work_root")).to.equal("~/.svm/projects");
    expect(readTopLevelScalar(yaml, "absent")).to.equal(null);
  });

  it("parses org-config and expands a portable ~ path", () => {
    const cfg = parseOrgConfig("org_name: Acme\ngithub_org: acme\ndefault_branch: main\nagent_work_root: '~/.acme/projects'\n");
    expect(cfg.orgName).to.equal("Acme");
    expect(cfg.githubOrg).to.equal("acme");
    expect(expandTilde("~/x", "/home/u")).to.equal("/home/u/x");
    expect(expandTilde("/abs", "/home/u"), "an absolute path is left alone").to.equal("/abs");
  });

  it("the fingerprint changes on mode, project, org-config CONTENT and cli MAJOR — and not on patch", () => {
    const base = { mode: "project" as const, projectPath: "PRJ-43", govRepo: "/g", orgConfigHash: "h1", services: {}, anomalies: [] };
    const fp = (o: Partial<typeof base>, env?: string, cli?: string) => contextFingerprint({ ...base, ...o }, env, cli);
    expect(fp({})).to.not.equal(fp({ mode: "governed" }));
    expect(fp({})).to.not.equal(fp({ projectPath: "PRJ-99" }));
    expect(fp({})).to.not.equal(fp({ orgConfigHash: "h2" }));
    expect(fp({}, "dev")).to.not.equal(fp({}, "prod"));
    expect(fp({}, "dev", "1.2.3")).to.equal(fp({}, "dev", "1.2.9"));
    expect(fp({}, "dev", "1.2.3")).to.not.equal(fp({}, "dev", "2.0.0"));
  });
});

describe("gov-core · the boundary itself", () => {
  // Rule 2 of the ADR: this package holds MECHANISM, our GRAMMAR stays in the clients. It is enforceable
  // by reading the package: no GOV_* role name, no secret-ref path grammar, may appear in it.
  it("exports no organisation-specific grammar", () => {
    // The EXPORTED NAMES, not the prose — index.ts documents what is deliberately absent, and a check that
    // read the comments would fail on the very sentence explaining the rule. (It did.)
    const src = readFileSync(new URL("../src/index.ts", import.meta.url), "utf8");
    const exported = src
      .replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "")                       // strip comments first
      .match(/export\s*\{[\s\S]*?\}\s*from/g)?.join(" ") ?? "";
    expect(exported, "no exports found — the parse is wrong, not the surface").to.contain("authPath");
    for (const grammar of ["ROLES_BY_TYPE", "parseSecretRef", "buildSecretRef", "accountRole", "GOV_ADMIN"]) {
      expect(exported, `'${grammar}' is grammar — it belongs in a client, not in a public MIT package`).to.not.contain(grammar);
    }
  });

  it("hard-codes no organisation URL — an adopter's install must not point at ours", () => {
    // An example in a doc comment is fine and useful; a default VALUE is a public package silently
    // addressing our IdP. This is the open ruling on gov-work's hard-coded `security.svayamtech.com`
    // default, kept from being inherited here.
    const dir = new URL("../src/", import.meta.url);
    for (const f of ["identity/oidc.ts", "secrets/vault.ts", "secrets/credentials.ts", "location/org-config.ts"]) {
      const code = readFileSync(new URL(f, dir), "utf8").replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
      expect(code, `${f} carries an org host outside a comment`).to.not.match(/svayamtech\.com|svayam\.ai/);
    }
  });

  it("the shipped sources carry no proprietary licence header", () => {
    // gov-work@1.1.0 shipped 16 compiled files marked LicenseRef-Svayam-Proprietary inside an MIT package.
    // This package IS the MIT one; a stray header here would republish that contradiction.
    const dir = new URL("../src/", import.meta.url);
    const files = ["index.ts", "identity/session.ts", "identity/oidc.ts", "secrets/credentials.ts",
      "secrets/vault.ts", "secrets/creds-flow.ts", "secrets/user-creds.ts", "secrets/needs.ts",
      "location/org-config.ts", "location/context.ts", "location/yaml.ts"];
    for (const f of files) {
      expect(readFileSync(new URL(f, dir), "utf8"), f).to.contain("SPDX-License-Identifier: MIT");
    }
  });
});

/** the package must be installable by an adopter — no dependency may creep in unnoticed. */
describe("gov-core · dependencies", () => {
  it("has no runtime dependencies", () => {
    const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
    expect(pkg.dependencies ?? {}, "a runtime dep here is a dep in every client").to.deep.equal({});
    expect(pkg.license).to.equal("MIT");
  });
});

// keep the imports honest — these are used above only via the fs helpers
void writeFileSync; void mkdirSync;

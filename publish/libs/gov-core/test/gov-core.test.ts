// SPDX-License-Identifier: MIT
/**
 * `gov-core` — the things three clients must agree about.
 *
 * These tests are written from the failures that made the package necessary, not from its exports: each one
 * pins a place where two independent copies of a rule disagreed, or could.
 */
import { expect } from "chai";
import { readFileSync } from "node:fs";
import { parseOrgConfig, expandTilde, readTopLevelScalar, detectContext, contextFingerprint } from "../src/index.js";

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
    expect(exported, "no exports found — the parse is wrong, not the surface").to.contain("detectContext");
    for (const grammar of ["ROLES_BY_TYPE", "parseSecretRef", "buildSecretRef", "accountRole", "GOV_ADMIN",
                           "vaultLogin", "saveSession", "credentialsPath", "login"]) {
      expect(exported, `'${grammar}' is grammar — it belongs in a client, not in a public MIT package`).to.not.contain(grammar);
    }
  });

  it("hard-codes no organisation URL — an adopter's install must not point at ours", () => {
    // An example in a doc comment is fine and useful; a default VALUE is a public package silently
    // addressing our IdP. This is the open ruling on gov-work's hard-coded `security.svayamtech.com`
    // default, kept from being inherited here.
    const dir = new URL("../src/", import.meta.url);
    for (const f of ["location/org-config.ts", "location/context.ts", "location/yaml.ts"]) {
      const code = readFileSync(new URL(f, dir), "utf8").replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
      expect(code, `${f} carries an org host outside a comment`).to.not.match(/svayamtech\.com|svayam\.ai/);
    }
  });

  it("the shipped sources carry no proprietary licence header", () => {
    // gov-work@1.1.0 ships 16 compiled files marked LicenseRef-Svayam-Proprietary inside an MIT package —
    // the identity/secrets layer. Narrowing this package to `location` means NOTHING is relicensed: every
    // file here was already MIT. This test keeps it that way when someone reaches for a fourth module.
    const dir = new URL("../src/", import.meta.url);
    const files = ["index.ts", "location/org-config.ts", "location/context.ts", "location/yaml.ts"];
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

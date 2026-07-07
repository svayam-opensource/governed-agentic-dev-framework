// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
import { expect } from "chai";
import {
  type NeedProbes, gitIdentityNeed, ghAuthNeed, registryTokenNeed,
  assembleNeeds, computeGap,
} from "../../src/security/needs.js";

// a probe set where everything is satisfied; override per-test to create GAPs.
const allOk = (over: Partial<Record<string, unknown>> = {}): NeedProbes => ({
  gitConfig: (k) => ({ "user.name": "R", "user.email": "r@o", ...(over.gitConfig as object) } as Record<string, string>)[k],
  ghAuthOk: () => (over.ghAuthOk as boolean) ?? true,
  hasCred: (k) => (over.creds as Set<string>)?.has(k) ?? true,
});

describe("security — NEED / GAP", () => {
  it("git-identity needs BOTH name and email", () => {
    expect(gitIdentityNeed.satisfied(allOk())).to.equal(true);
    expect(gitIdentityNeed.satisfied(allOk({ gitConfig: { "user.email": "" } }))).to.equal(false);
    expect(gitIdentityNeed.satisfied({ gitConfig: () => undefined, ghAuthOk: () => true, hasCred: () => true })).to.equal(false);
  });

  it("gh-auth reflects the auth probe", () => {
    expect(ghAuthNeed.satisfied(allOk())).to.equal(true);
    expect(ghAuthNeed.satisfied(allOk({ ghAuthOk: false }))).to.equal(false);
  });

  it("registry token: id/credKey = the plugin-supplied standard key, satisfied by a stored cred", () => {
    const oidc = registryTokenNeed("https://npm.svayamtech.com", "oidc", "AUTHENTIK_UAT_API_TOKEN");
    const pub = registryTokenNeed("https://registry.npmjs.org", "token", "NPMJS_ACCESS_TOKEN");
    expect(oidc.credKey).to.equal("AUTHENTIK_UAT_API_TOKEN");
    expect(oidc.id).to.equal("AUTHENTIK_UAT_API_TOKEN");
    expect(oidc.instructions).to.match(/OIDC-fronted/);
    expect(oidc.instructions).to.match(/Do NOT run `npm login`/);
    expect(pub.instructions).to.match(/Automation/);
    expect(oidc.satisfied(allOk({ creds: new Set(["AUTHENTIK_UAT_API_TOKEN"]) }))).to.equal(true);
    expect(oidc.satisfied(allOk({ creds: new Set<string>() }))).to.equal(false);
  });

  it("assembleNeeds = base (git, gh) + extras, in order", () => {
    const extra = registryTokenNeed("https://npm.svayamtech.com", "oidc", "AUTHENTIK_UAT_API_TOKEN");
    expect(assembleNeeds([extra]).map((n) => n.id)).to.deep.equal(["git-identity", "gh-auth", extra.id]);
    expect(assembleNeeds().map((n) => n.id)).to.deep.equal(["git-identity", "gh-auth"]);
  });

  it("computeGap returns exactly the unmet needs, in declared order", () => {
    const token = registryTokenNeed("https://npm.svayamtech.com", "oidc", "AUTHENTIK_UAT_API_TOKEN");
    const need = assembleNeeds([token]);
    // missing git email + missing the token; gh ok
    const probes = allOk({ gitConfig: { "user.email": "" }, creds: new Set<string>() });
    expect(computeGap(need, probes).map((n) => n.id)).to.deep.equal(["git-identity", token.id]);
    // everything satisfied → empty GAP
    expect(computeGap(need, allOk({ creds: new Set([token.id]) }))).to.deep.equal([]);
  });
});

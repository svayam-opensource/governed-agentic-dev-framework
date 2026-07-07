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

  it("registry token: keyed by the plugin's standard key; instructions SHIELD the developer", () => {
    const priv = registryTokenNeed("https://npm.svayamtech.com", "AUTHENTIK_UAT_API_TOKEN");
    const pub = registryTokenNeed("https://registry.npmjs.org", "NPMJS_ACCESS_TOKEN");
    expect(priv.credKey).to.equal("AUTHENTIK_UAT_API_TOKEN");
    expect(priv.id).to.equal("AUTHENTIK_UAT_API_TOKEN");
    // shielded: plain where/what/paste — NO auth-method jargon, NO internal key name
    expect(priv.instructions).to.match(/Paste it below/);
    expect(priv.instructions).to.not.match(/OIDC|bearer|OAUTH|API_TOKEN|store key/i);
    expect(priv.instructions).to.not.include("AUTHENTIK_UAT_API_TOKEN");
    expect(pub.instructions).to.match(/npmjs\.com/);
    expect(priv.satisfied(allOk({ creds: new Set(["AUTHENTIK_UAT_API_TOKEN"]) }))).to.equal(true);
    expect(priv.satisfied(allOk({ creds: new Set<string>() }))).to.equal(false);
  });

  it("assembleNeeds = base (git, gh) + extras, in order", () => {
    const extra = registryTokenNeed("https://npm.svayamtech.com", "AUTHENTIK_UAT_API_TOKEN");
    expect(assembleNeeds([extra]).map((n) => n.id)).to.deep.equal(["git-identity", "gh-auth", extra.id]);
    expect(assembleNeeds().map((n) => n.id)).to.deep.equal(["git-identity", "gh-auth"]);
  });

  it("computeGap returns exactly the unmet needs, in declared order", () => {
    const token = registryTokenNeed("https://npm.svayamtech.com", "AUTHENTIK_UAT_API_TOKEN");
    const need = assembleNeeds([token]);
    // missing git email + missing the token; gh ok
    const probes = allOk({ gitConfig: { "user.email": "" }, creds: new Set<string>() });
    expect(computeGap(need, probes).map((n) => n.id)).to.deep.equal(["git-identity", token.id]);
    // everything satisfied → empty GAP
    expect(computeGap(need, allOk({ creds: new Set([token.id]) }))).to.deep.equal([]);
  });
});

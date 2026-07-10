// SPDX-License-Identifier: LicenseRef-Svayam-Proprietary
/** Policy-declared credential NEEDs: gov-work creds reads the `credentials:` block from the org's
 *  build/deploy policies and turns each key into a NEED. Line-oriented parse (gov-work is dep-free). */
import { expect } from "chai";
import { parseCredentialDecls, policyCredNeeds, readPolicyCredNeeds } from "../../src/security/policy-needs.js";
import type { NeedProbes } from "../../src/security/needs.js";

const DEPLOY = `
# deploy-policy.yaml
orchestrator:
  kind: jenkins
credentials:
  - key: GOV_ATTEST_SECRET
    title: attestation signing/verify secret
    where: Jenkins gov-attest-signing-key credential
    env: GOV_ATTEST_SECRET
  - key: NPMJS_ACCESS_TOKEN
    title: npm publish token
    where: "npmjs.com → Access Tokens"   # inline comment stripped
    env: GOV_NPM_TOKEN
allowedIssuers:
  dev: [svayam-jenkins]
`;
const BUILD = `
credentials:
  - key: JENKINS_API_TOKEN
    title: Jenkins trigger token
  - key: GOV_ATTEST_SECRET          # duplicate — deploy's copy already declared it
    title: dup
`;

describe("security/policy-needs — credentials declared in policy", () => {
  it("parses the credentials block (key/title/where/env; ignores other sections + inline comments)", () => {
    const d = parseCredentialDecls(DEPLOY);
    expect(d.map((x) => x.key)).to.deep.equal(["GOV_ATTEST_SECRET", "NPMJS_ACCESS_TOKEN"]);
    expect(d[0]).to.include({ title: "attestation signing/verify secret", env: "GOV_ATTEST_SECRET" });
    expect(d[1].where).to.equal("npmjs.com → Access Tokens");
  });

  it("no credentials block → empty", () => {
    expect(parseCredentialDecls("ports:\n  registry: routing\n")).to.deep.equal([]);
  });

  it("policyCredNeeds: a declared key is a NEED, satisfied iff the store holds it", () => {
    const [need] = policyCredNeeds([{ key: "GOV_ATTEST_SECRET", where: "from Jenkins" }]);
    expect(need.credKey).to.equal("GOV_ATTEST_SECRET");
    expect(need.instructions).to.match(/from Jenkins/);
    const has = (keys: string[]): NeedProbes => ({ gitConfig: () => undefined, ghAuthOk: () => false, hasCred: (k) => keys.includes(k) });
    expect(need.satisfied(has([]))).to.equal(false);
    expect(need.satisfied(has(["GOV_ATTEST_SECRET"]))).to.equal(true);
  });

  it("readPolicyCredNeeds: unions build + deploy, de-dupes by key (first wins)", () => {
    const files: Record<string, string> = {
      "/gov/knowledge/deployment/build-policy.yaml": BUILD,
      "/gov/knowledge/deployment/deploy-policy.yaml": DEPLOY,
    };
    const needs = readPolicyCredNeeds((p) => files[p] ?? null, "/gov");
    expect(needs.map((n) => n.credKey)).to.deep.equal(["JENKINS_API_TOKEN", "GOV_ATTEST_SECRET", "NPMJS_ACCESS_TOKEN"]);
    // build-policy is read first, so its GOV_ATTEST_SECRET (title "dup") wins the de-dupe over deploy's.
    expect(needs.find((n) => n.credKey === "GOV_ATTEST_SECRET")!.title).to.equal("dup");
  });

  it("missing policy files → no policy needs (just returns [])", () => {
    expect(readPolicyCredNeeds(() => null, "/nope")).to.deep.equal([]);
  });
});

// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
import { expect } from "chai";
import { readFileSync } from "node:fs";
import { type NeedProbes, gitIdentityNeed, ghAuthNeed, assembleNeeds, computeGap } from "../../src/security/needs.js";

// a probe set where everything is satisfied; override per-test to create GAPs.
const allOk = (over: Partial<Record<string, unknown>> = {}): NeedProbes => ({
  gitConfig: (k) => ({ "user.name": "R", "user.email": "r@o", ...(over.gitConfig as object) } as Record<string, string>)[k],
  ghAuthOk: () => (over.ghAuthOk as boolean) ?? true,
});

describe("NEED / GAP — gov-work's own two requirements", () => {
  it("git-identity needs BOTH name and email", () => {
    expect(gitIdentityNeed.satisfied(allOk())).to.equal(true);
    expect(gitIdentityNeed.satisfied(allOk({ gitConfig: { "user.email": "" } }))).to.equal(false);
    expect(gitIdentityNeed.satisfied({ gitConfig: () => undefined, ghAuthOk: () => true })).to.equal(false);
  });

  it("gh-auth reflects the auth probe", () => {
    expect(ghAuthNeed.satisfied(allOk())).to.equal(true);
    expect(ghAuthNeed.satisfied(allOk({ ghAuthOk: false }))).to.equal(false);
  });

  it("the NEED set is exactly those two — there is no 'extras' hook any more", () => {
    expect(assembleNeeds().map((n) => n.id)).to.deep.equal(["git-identity", "gh-auth"]);
    expect(assembleNeeds.length, "an arity of 0: a plugin's credential NEEDs are that plugin's business now").to.equal(0);
  });

  it("computeGap returns exactly the unmet needs, in declared order", () => {
    expect(computeGap(assembleNeeds(), allOk({ gitConfig: { "user.email": "" }, ghAuthOk: false })).map((n) => n.id))
      .to.deep.equal(["git-identity", "gh-auth"]);
    expect(computeGap(assembleNeeds(), allOk())).to.deep.equal([]);
  });

  // Both NEEDs are checks on the USER'S OWN TOOLS, and gov-work no longer has a credential store or an
  // identity provider (ADR: three clients, 2026-08-06). So every NEED must be fixable by the user with the
  // instructions it carries — a GAP that could only be closed by a `gov creds` verb would now be a dead end.
  it("every NEED is satisfiable by the user's own tooling, and says how", () => {
    for (const n of assembleNeeds()) {
      expect(n.instructions, `${n.id} must name the command that fixes it`).to.match(/git config|gh auth/);
      expect(n, `${n.id} must not be credential-store backed`).to.not.have.property("credKey");
    }
  });

  it("no credential-store concept survives in this module", () => {
    // CODE, not prose: the module's doc comment explains what left, and a check that read the comments
    // would fail on the very sentence recording the decision. (It did — twice today.)
    const src = readFileSync(new URL("../../src/security/needs.ts", import.meta.url), "utf8")
      .replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
    for (const gone of ["hasCred", "credKey", "credNeedForKey", "registryTokenNeed"]) {
      expect(src, `'${gone}' belongs to the deploy clients now`).to.not.contain(gone);
    }
  });
});

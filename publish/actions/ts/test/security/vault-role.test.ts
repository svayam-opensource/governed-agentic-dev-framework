// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * The Vault role a caller opens their session as, decided from gov roles.
 *
 * Replaces `roles[0]?.toLowerCase().replace(/_/g, "-")` — a POSITIONAL pick, where the privilege a session
 * ran with depended on whichever role the claim happened to serialise first. It was masked because everyone
 * holding several roles also held `GOV_ADMIN`, which a special case caught first.
 *
 * 911#184 removes the cover: release engineers go from one role to three (`GOV_DEVELOPER`,
 * `GOV_RELEASE_UAT`, `GOV_RELEASE_PROD`) and all three derived names now exist as real Vault roles — so the
 * coin-flip starts landing on different, VALID answers, silently. gov-infra's framing on 910#21: the
 * migration does not create the bug, it removes what was hiding it.
 */
import { expect } from "chai";
import { vaultRoleFor, UnmappedGovRoleError, VAULT_ROLE_MAP } from "../../src/security/vault-role.js";

describe("vault role — declared precedence, never claim order", () => {
  // THE REGRESSION. These are vishnu/princy's roles after `migrate:latest`. Every ordering must agree.
  it("gives the same answer for the same roles in ANY order", () => {
    const after = ["GOV_DEVELOPER", "GOV_RELEASE_UAT", "GOV_RELEASE_PROD"];
    const orderings = [
      after,
      ["GOV_RELEASE_PROD", "GOV_DEVELOPER", "GOV_RELEASE_UAT"],
      ["GOV_RELEASE_UAT", "GOV_RELEASE_PROD", "GOV_DEVELOPER"],
      [...after].reverse(),
    ];
    const answers = new Set(orderings.map((o) => vaultRoleFor(o)));
    expect([...answers]).to.deep.equal(["gov-release-prod"]);   // one answer, and it is the privileged one
  });

  it("keeps GOV_ADMIN winning, from any position", () => {
    expect(vaultRoleFor(["GOV_ADMIN", "GOV_DEVELOPER"])).to.equal("gov-admin");
    expect(vaultRoleFor(["GOV_DEVELOPER", "GOV_SYSADMIN", "GOV_ADMIN"])).to.equal("gov-admin");
  });

  // The pre-911#184 world must keep working — the migration is not simultaneous everywhere.
  it("still maps the roles held today", () => {
    expect(vaultRoleFor(["GOV_RELEASE"])).to.equal("gov-release");
    expect(vaultRoleFor(["GOV_DEVELOPER"])).to.equal("gov-developer");
  });

  it("prefers prod over uat when both are held — a superset is not a coin flip", () => {
    expect(vaultRoleFor(["GOV_RELEASE_UAT", "GOV_RELEASE_PROD"])).to.equal("gov-release-prod");
  });

  it("lets an explicit GOV_BAO_JWT_ROLE win — being explicit is the opposite of this bug", () => {
    expect(vaultRoleFor(["GOV_ADMIN"], "gov-policy-admin")).to.equal("gov-policy-admin");
    expect(vaultRoleFor([], "gov-policy-admin")).to.equal("gov-policy-admin");
  });

  describe("an unknown role is LOUD (gov-infra's suggestion, 910#21)", () => {
    // Silence is what let a positional pick look like it worked. A name derived for an unmapped role either
    // hits a Vault role that does not exist (confusing) or one that does (dangerous).
    it("throws naming the role, instead of inventing a Vault role name", () => {
      expect(() => vaultRoleFor(["GOV_SOMETHING_NEW"])).to.throw(UnmappedGovRoleError);
      try { vaultRoleFor(["GOV_SOMETHING_NEW"]); expect.fail("should have thrown"); }
      catch (e) {
        expect((e as Error).message).to.contain("GOV_SOMETHING_NEW");
        expect((e as Error).message).to.contain("VAULT_ROLE_MAP");   // tells you where to fix it
      }
    });

    // "no roles" is a DIFFERENT condition from "a role I do not know" — callers already report the first
    // one usefully ("your token carries no gov role"), and turning it into a throw would regress that.
    it("returns undefined for no roles at all, rather than throwing", () => {
      expect(vaultRoleFor([])).to.equal(undefined);
      expect(vaultRoleFor(["", null as unknown as string])).to.equal(undefined);
    });
  });

  it("maps every gov role to a distinct vault role (no two govs collide)", () => {
    const vault = VAULT_ROLE_MAP.map(([, v]) => v);
    expect(new Set(vault).size).to.equal(vault.length);
  });
});

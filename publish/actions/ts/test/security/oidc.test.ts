/* --------------------------------------------------------------------------------------------------
 *  Copyright (c) 2026 - Svayam Infoware Pvt. Ltd. All rights reserved.
 *  ------------------------------------------------------------------------------------------------*/
/** `gov auth login` pure bits: JWT claim decode (display-only, no verify). */
import { expect } from "chai";
import { claimsOf } from "../../src/security/oidc.js";

const b64url = (o: unknown): string => Buffer.from(JSON.stringify(o)).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const jwt = (claims: unknown): string => `${b64url({ alg: "RS256" })}.${b64url(claims)}.sig`;

describe("oidc — claimsOf (svayam_jwt display)", () => {
  it("decodes account_ctx + roles + email from a svayam_jwt", () => {
    const c = claimsOf(jwt({ sub: "ip-1", email: "rkant@svayam.ai", account_ctx: 1000, roles: ["GOV_ADMIN"], aud: "gov" }));
    expect(c.account_ctx).to.equal(1000);
    expect(c.roles).to.deep.equal(["GOV_ADMIN"]);
    expect(c.email).to.equal("rkant@svayam.ai");
  });
  it("returns {} on a malformed token (never throws)", () => {
    expect(claimsOf("not-a-jwt")).to.deep.equal({});
  });
});

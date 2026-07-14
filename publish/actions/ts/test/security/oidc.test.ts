/* --------------------------------------------------------------------------------------------------
 *  Copyright (c) 2026 - Svayam Infoware Pvt. Ltd. All rights reserved.
 *  ------------------------------------------------------------------------------------------------*/
/** `gov auth login` pure bits: JWT claim decode (display-only, no verify). */
import { expect } from "chai";
import { claimsOf, loginServiceTokenExchange } from "../../src/security/oidc.js";

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

describe("oidc — loginServiceTokenExchange (headless service login)", () => {
  it("POSTs token-exchange with subject_token + audience + account, returns both tokens", async () => {
    const orig = globalThis.fetch;
    const calls: { url: string; body?: string }[] = [];
    globalThis.fetch = (async (url: string, init?: { body?: unknown }) => {
      calls.push({ url: String(url), body: init?.body ? String(init.body) : undefined });
      if (String(url).includes("/.well-known/openid-configuration")) {
        return { ok: true, json: async () => ({ authorization_endpoint: "https://iam/authorize", token_endpoint: "https://iam/token" }) } as Response;
      }
      return { ok: true, json: async () => ({
        access_token: jwt({ sub: "ip-gov-ci", account_ctx: 1000, roles: ["GOV_CI"], aud: "gov" }),
        id_token: jwt({ sub: "ip-gov-ci", email: "gov-ci@svayam.ai" }),
        expires_in: 300,
      }) } as Response;
    }) as typeof fetch;
    try {
      const tokens = await loginServiceTokenExchange({ issuer: "https://iam", clientId: "gov", audience: "gov", scopes: "openid email profile" }, "app-password", "1000");
      const tokenCall = calls.find((c) => c.url === "https://iam/token");
      expect(tokenCall, "token endpoint called").to.exist;
      expect(tokenCall!.body).to.contain("grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Atoken-exchange");
      expect(tokenCall!.body).to.contain("subject_token=app-password");
      expect(tokenCall!.body).to.contain("audience=gov");
      expect(tokenCall!.body).to.contain("account=1000");
      expect(tokens.idToken, "id_token returned").to.be.a("string");
      const c = claimsOf(tokens.accessToken ?? tokens.idToken);
      expect(c.roles).to.deep.equal(["GOV_CI"]);
      expect(c.account_ctx).to.equal(1000);
    } finally {
      globalThis.fetch = orig;
    }
  });
});

// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * CiIdentityPort (PRJ-121 intent 03, D7, plan L04). "Am I running in a CI that can prove who started me, and what
 * does the proof say?" — the question intent 02's lease-by-OIDC asks. GitHub Actions answers it with an OIDC
 * token requested from ACTIONS_ID_TOKEN_REQUEST_URL; outside CI there is no token and the port says so.
 *
 * No network: `fetch` is a fake that records what it was asked.
 */
import { expect } from "chai";
import { createGithubCiIdentity } from "../../src/adapters/github/ci-identity.js";
import { createMemoryCiIdentity } from "../../src/adapters/memory/ci-identity.js";
import { decodeJwtClaims, type CiClaims, type CiIdentityPort } from "../../src/ports/ci-identity.js";
import { builtInProviders, pickAdapter } from "../../src/adapters/registry.js";

const b64url = (o: unknown): string => Buffer.from(JSON.stringify(o)).toString("base64url");
const PAYLOAD = {
  iss: "https://token.actions.githubusercontent.com",
  sub: "repo:svayam-e2e/demo:ref:refs/heads/dev",
  aud: "gov",
  repository: "svayam-e2e/demo",
  repository_owner_id: "123456",
  actor: "rkant",
  ref: "refs/heads/dev",
  run_id: "987654321",
};
const JWT = `${b64url({ alg: "RS256", typ: "JWT" })}.${b64url(PAYLOAD)}.c2lnbmF0dXJl`;
const CLAIMS: CiClaims = {
  issuer: PAYLOAD.iss, subject: PAYLOAD.sub, repository: PAYLOAD.repository, ownerId: PAYLOAD.repository_owner_id,
  actor: PAYLOAD.actor, ref: PAYLOAD.ref, runId: PAYLOAD.run_id,
};

const CI_ENV = {
  ACTIONS_ID_TOKEN_REQUEST_URL: "https://pipelines.actions.example/idtoken?api-version=2.0",
  ACTIONS_ID_TOKEN_REQUEST_TOKEN: "request-bearer",
};

interface Call { url: string; auth: string | null }
function fakeFetch(body: unknown, status = 200): { fetch: typeof globalThis.fetch; calls: Call[] } {
  const calls: Call[] = [];
  const fetch = (async (url: string | URL, init?: RequestInit) => {
    const h = new Headers(init?.headers);
    calls.push({ url: String(url), auth: h.get("authorization") });
    return new Response(typeof body === "string" ? body : JSON.stringify(body), { status });
  }) as typeof globalThis.fetch;
  return { fetch, calls };
}

describe("ports — CiIdentityPort, GitHub adapter", () => {
  it("not in CI → available() false, token null, claims null, and nothing is fetched", async () => {
    const f = fakeFetch({ value: JWT });
    const ci = createGithubCiIdentity({ env: {}, fetch: f.fetch });
    expect(ci.available()).to.equal(false);
    expect(await ci.oidcToken("gov")).to.equal(null);
    expect(ci.claims()).to.equal(null);
    expect(f.calls).to.deep.equal([]);
  });

  it("only one of the two variables (no id-token permission) is not available either", () => {
    const ci = createGithubCiIdentity({ env: { ACTIONS_ID_TOKEN_REQUEST_URL: CI_ENV.ACTIONS_ID_TOKEN_REQUEST_URL }, fetch: fakeFetch({}).fetch });
    expect(ci.available()).to.equal(false);
  });

  it("env present → the token is fetched with the audience, bearing the request token", async () => {
    const f = fakeFetch({ value: JWT });
    const ci = createGithubCiIdentity({ env: CI_ENV, fetch: f.fetch });
    expect(ci.available()).to.equal(true);
    expect(await ci.oidcToken("gov cicd")).to.equal(JWT);
    expect(f.calls).to.have.length(1);
    const u = new URL(f.calls[0]!.url);
    expect(u.searchParams.get("api-version"), "keeps the URL's own query").to.equal("2.0");
    expect(u.searchParams.get("audience")).to.equal("gov cicd");
    expect(f.calls[0]!.auth).to.equal("bearer request-bearer");
  });

  it("claims are parsed from the token's payload", async () => {
    const ci = createGithubCiIdentity({ env: CI_ENV, fetch: fakeFetch({ value: JWT }).fetch });
    expect(ci.claims(), "none before a token is fetched").to.equal(null);
    await ci.oidcToken("gov");
    expect(ci.claims()).to.deep.equal(CLAIMS);
  });

  it("a refused request rejects with the status — never resolves null as if not in CI", async () => {
    const ci = createGithubCiIdentity({ env: CI_ENV, fetch: fakeFetch("nope", 403).fetch });
    let err: Error | undefined;
    try { await ci.oidcToken("gov"); } catch (e) { err = e as Error; }
    expect(err?.message).to.contain("403");
    expect(err?.message).to.not.contain("request-bearer");
  });

  it("a reply that is not a JWT rejects, and its text is not repeated", async () => {
    const ci = createGithubCiIdentity({ env: CI_ENV, fetch: fakeFetch({ value: "not-a-jwt-secretish" }).fetch });
    let err: Error | undefined;
    try { await ci.oidcToken("gov"); } catch (e) { err = e as Error; }
    expect(err?.message).to.match(/JWT/);
    expect(err?.message).to.not.contain("secretish");
  });

  it("is registered as the github adapter for ciIdentity", () => {
    const ci = pickAdapter(builtInProviders, "ciIdentity", "github", { env: {} });
    expect(ci.available()).to.equal(false);
  });
});

describe("ports — decodeJwtClaims", () => {
  it("reads the payload without verifying, and maps GitHub's names to the port's", () => {
    expect(decodeJwtClaims(JWT)).to.deep.equal(CLAIMS);
  });
  it("numbers become strings; missing claims are empty", () => {
    const t = `${b64url({})}.${b64url({ iss: "x", run_id: 5, repository_owner_id: 7 })}.s`;
    expect(decodeJwtClaims(t)).to.deep.include({ issuer: "x", runId: "5", ownerId: "7", actor: "" });
  });
  it("not three parts, or a payload that is not JSON → null", () => {
    expect(decodeJwtClaims("a.b")).to.equal(null);
    expect(decodeJwtClaims("a.@@@.c")).to.equal(null);
  });
});

describe("ports — CiIdentityPort, memory adapter", () => {
  it("off by default: not available, token null", async () => {
    const ci: CiIdentityPort = createMemoryCiIdentity();
    expect(ci.available()).to.equal(false);
    expect(await ci.oidcToken("gov")).to.equal(null);
    expect(ci.claims()).to.equal(null);
  });
  it("given claims: available, a token per audience, and the claims after a fetch", async () => {
    const ci = createMemoryCiIdentity({ claims: CLAIMS });
    expect(ci.available()).to.equal(true);
    expect(ci.claims()).to.equal(null);
    expect(await ci.oidcToken("gov")).to.be.a("string").and.contain("gov");
    expect(ci.claims()).to.deep.equal(CLAIMS);
    expect(ci.audiences).to.deep.equal(["gov"]);
  });
  it("is registered as the memory adapter for ciIdentity", () => {
    expect(pickAdapter(builtInProviders, "ciIdentity", "memory").available()).to.equal(false);
  });
});

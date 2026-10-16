// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * CiIdentityPort on GitHub Actions (PRJ-121 intent 03, L04).
 *
 * A job granted `permissions: id-token: write` gets two variables: ACTIONS_ID_TOKEN_REQUEST_URL and
 * ACTIONS_ID_TOKEN_REQUEST_TOKEN. GET the URL with `audience=<aud>` added, bearing the request token, and the reply
 * is `{ "value": "<jwt>" }`. Without both variables there is no token to be had — not in Actions, or the job was
 * not given the permission — and the port says so rather than guessing.
 *
 * Neither the request token nor the OIDC token is logged or put in an error message.
 */
import { decodeJwtClaims, type CiClaims, type CiIdentityPort } from "../../ports/ci-identity.js";
import { log } from "../../log.js";

const PGM = "gov-work:adapters:github:ci-identity";

export interface GithubCiIdentityDeps {
  /** Default: `process.env`. */
  readonly env?: Readonly<Record<string, string | undefined>>;
  /** Default: the global `fetch`. */
  readonly fetch?: typeof globalThis.fetch;
}

export function createGithubCiIdentity(deps: GithubCiIdentityDeps = {}): CiIdentityPort {
  const env = deps.env ?? process.env;
  const doFetch = deps.fetch ?? globalThis.fetch;
  const url = (): string => (env.ACTIONS_ID_TOKEN_REQUEST_URL ?? "").trim();
  const bearer = (): string => (env.ACTIONS_ID_TOKEN_REQUEST_TOKEN ?? "").trim();
  let last: CiClaims | null = null;

  return {
    available: () => url() !== "" && bearer() !== "",

    async oidcToken(audience) {
      if (!url() || !bearer()) return null;
      const u = new URL(url());
      u.searchParams.set("audience", audience);
      log("info", "requesting a CI identity token", PGM, "oidcToken", { audience, host: u.host });
      const res = await doFetch(u.toString(), { headers: { authorization: `bearer ${bearer()}`, accept: "application/json" } });
      if (!res.ok) {
        log("warn", "CI identity token refused", PGM, "oidcToken", { audience, status: res.status });
        throw new Error(`GitHub Actions refused the identity token request (HTTP ${res.status}) — does the job have \`permissions: id-token: write\`?`);
      }
      let value: unknown;
      try { value = ((await res.json()) as { value?: unknown })?.value; } catch (e) {
        throw new Error(`GitHub Actions answered the identity token request with something that is not JSON (${(e as Error).name})`, { cause: e });
      }
      const claims = typeof value === "string" ? decodeJwtClaims(value) : null;
      if (typeof value !== "string" || !claims) throw new Error("GitHub Actions answered the identity token request without a JWT");
      last = claims;
      log("info", "obtained a CI identity token", PGM, "oidcToken", { audience, issuer: claims.issuer, repository: claims.repository, runId: claims.runId });
      return value;
    },

    claims: () => last,
  };
}

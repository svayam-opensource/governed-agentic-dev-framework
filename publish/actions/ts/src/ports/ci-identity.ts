// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * CiIdentityPort — "am I running in a CI that can prove who started me, and what does the proof say?"
 * (PRJ-121 intent 03, D7, spec §6). Intent 02's lease-by-OIDC and autorun-in-CI (Q16) build on it.
 *
 * The proof is an OIDC token: a JWT the CI's identity provider signs, naming the repository, the ref, the run and
 * who started it. A VERIFIER (a broker, a cloud) checks its signature; this port only obtains it and reads what it
 * says, so {@link decodeJwtClaims} does not verify, and nothing here may treat the claims as proven.
 *
 * The token is a credential. No adapter logs it, puts it in an error, or keeps it beyond the claims it carried.
 */

/** What the token says, in the port's words. Every value is a string; a claim the token lacks is "". */
export interface CiClaims {
  /** Who signed it (`iss`), e.g. https://token.actions.githubusercontent.com. */
  readonly issuer: string;
  /** What it is about (`sub`), e.g. repo:org/name:ref:refs/heads/dev. */
  readonly subject: string;
  /** owner/name of the repository the run belongs to. */
  readonly repository: string;
  /** The repository owner's numeric id — stable across renames, unlike its name. */
  readonly ownerId: string;
  /** Who started the run. */
  readonly actor: string;
  /** The git ref the run is for. */
  readonly ref: string;
  /** The CI run's id. */
  readonly runId: string;
}

export interface CiIdentityPort {
  /** True when running in a CI that will issue an OIDC token to this job. */
  available(): boolean;
  /**
   * An OIDC token for `audience`. `null` ONLY when {@link available} is false — not in CI is an answer. A CI that
   * refuses or answers nonsense REJECTS with the reason (never the token), because a null there would read as
   * "not in CI" and hide the failure.
   */
  oidcToken(audience: string): Promise<string | null>;
  /** The claims of the last token obtained; `null` before one has been. */
  claims(): CiClaims | null;
}

/**
 * Read a JWT's payload WITHOUT verifying it, mapping the standard and GitHub claim names to {@link CiClaims}.
 * `null` when the text is not a JWT. Never throws.
 */
export function decodeJwtClaims(jwt: string): CiClaims | null {
  const parts = jwt.split(".");
  if (parts.length !== 3) return null;
  let p: unknown;
  try { p = JSON.parse(Buffer.from(parts[1]!, "base64url").toString("utf8")); } catch { return null; /* not a JWT payload: the caller reports it */ }
  if (typeof p !== "object" || p === null || Array.isArray(p)) return null;
  const c = p as Record<string, unknown>;
  const s = (k: string): string => (c[k] === undefined || c[k] === null ? "" : String(c[k]));
  return {
    issuer: s("iss"), subject: s("sub"), repository: s("repository"), ownerId: s("repository_owner_id"),
    actor: s("actor"), ref: s("ref"), runId: s("run_id"),
  };
}

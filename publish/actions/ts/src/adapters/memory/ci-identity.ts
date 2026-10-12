// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * CiIdentityPort in memory — for tests. Not in CI unless given claims; given them, it issues a fake token per
 * audience (recorded in `audiences`) and reports the claims once one has been asked for, as a real CI does.
 */
import type { CiClaims, CiIdentityPort } from "../../ports/ci-identity.js";

export interface MemoryCiIdentity extends CiIdentityPort {
  /** Every audience a token was requested for, in order. */
  readonly audiences: readonly string[];
}

export function createMemoryCiIdentity(opts: { readonly claims?: CiClaims } = {}): MemoryCiIdentity {
  const audiences: string[] = [];
  let fetched = false;
  return {
    audiences,
    available: () => opts.claims !== undefined,
    async oidcToken(audience) {
      if (!opts.claims) return null;
      audiences.push(audience);
      fetched = true;
      return `memory-oidc-token:${audience}`;
    },
    claims: () => (fetched && opts.claims ? opts.claims : null),
  };
}

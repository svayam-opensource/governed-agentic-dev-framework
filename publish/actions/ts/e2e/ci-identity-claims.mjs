// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * LIVE CHECK OF CiIdentityPort (PRJ-121 intent 03, L04): in a GitHub Actions job with `id-token: write`, obtain an
 * OIDC token through the built GitHub adapter and print its CLAIMS — never the token. Outside Actions (or on a
 * fork PR, which gets no id-token permission) it says it is not available and exits 0.
 *
 *   node e2e/ci-identity-claims.mjs [audience]      (after `npm run build`)
 */
import { createGithubCiIdentity } from "../lib/esm/adapters/github/ci-identity.js";

const audience = process.argv[2] || "gov-e2e";
const ci = createGithubCiIdentity();
if (!ci.available()) {
  console.log("ci-identity: not available here (no ACTIONS_ID_TOKEN_REQUEST_URL/TOKEN) — nothing to check");
  process.exit(0);
}
try {
  const token = await ci.oidcToken(audience);
  if (!token) throw new Error("available, yet no token");
  const c = ci.claims();
  if (!c || !c.issuer || !c.repository || !c.runId) throw new Error(`claims incomplete: ${JSON.stringify(c)}`);
  console.log(`ci-identity: audience ${audience}`);
  console.log(JSON.stringify(c, null, 2));
} catch (e) {
  console.error(`ci-identity: FAILED — ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
}

// SPDX-License-Identifier: MIT
/**
 * `@svayam-opensource/gov-core` — what the gov clients must AGREE about.
 *
 * `gov` (gov-work), `gov-cicd` and `gov-infra` are three independent CLIs (ADR: three clients). They are not
 * plugins of one another and share no runtime; what they DO share is state on disk and one identity. Every
 * such shared thing lives here, in one implementation, because the alternative has been tried: on
 * 2026-08-04 the host wrote `preferences/<os-user>/gov-auth.json` as `{accessToken,idToken,expiresAt}` while
 * the plugin read `preferences/<email>/gov-auth.json` expecting `{token,user}` — a successful login could
 * not authenticate a governed verb BY CONSTRUCTION, and it surfaced only with no TTY, in automation, where
 * nobody could intervene (#45).
 *
 * TWO RULES DECIDE WHAT BELONGS HERE:
 *
 *   1. it is here only if TWO OR MORE CLIENTS MUST AGREE about it — a shared file on disk, or a shared
 *      identity. One client's business stays in that client.
 *   2. this package holds MECHANISM; our GRAMMAR stays in the clients. A keyed file store, an OIDC
 *      exchange, a scalar reader and an HTTP Vault client are mechanism. Path grammars, role names and
 *      `GOV_*` conventions are grammar — and this package is MIT and public.
 *
 * Rule 2 is why `parseSecretRef`, `ROLES_BY_TYPE` and `accountRole()` are NOT here: `vaultLogin` takes the
 * role as a parameter and knows nothing about what roles the caller's organisation has.
 *
 * Every export is also a reason three packages might have to release together, so the surface stays small
 * on purpose.
 */

// ── identity — who you are, and where that is written down ──────────────────────────────────────────
export {
  authPath, currentIdentityPath, readCurrentIdentity, writeCurrentIdentity,
  saveSession, loadSession, sessionIdentity, saveAuth, loadAuth, clearAuth,
  type Session,
} from "./identity/session.js";
export { login, loginServiceTokenExchange, claimsOf, type OidcConfig, type Tokens } from "./identity/oidc.js";

// ── secrets — the per-user credential store, the NEED/GAP model, and the Vault client ───────────────
export {
  credentialsPath, credKey, parseCredentials, getCredential, listCredentialKeys, setCredential,
  listIdentities, identityExists, defaultIdentity,
} from "./secrets/credentials.js";
export { computeGap, type Need, type NeedProbes } from "./secrets/needs.js";
export { selectIdentity, runCreds, type CredsFlowDeps, type CredsFlowResult } from "./secrets/creds-flow.js";
export { vaultLogin, kvRead, kvWrite, transitSign, transitVerify, type VaultCfg } from "./secrets/vault.js";
export { credsSubject, userCredsList, userCredsSet, type UserCredsCfg } from "./secrets/user-creds.js";

// ── location — which org, which repo, which branch you are acting on ────────────────────────────────
export { parseOrgConfig, type OrgConfig } from "./location/org-config.js";
export { expandTilde, readTopLevelScalar } from "./location/yaml.js";
export {
  detectContext, contextFingerprint, renderBanner, isAcked, recordAck, hashText,
  type ContextMode, type ContextInfo, type ContextFacts, type Ack,
} from "./location/context.js";

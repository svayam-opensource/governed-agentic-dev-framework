// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd. — part of the OSS governed-agentic-dev-framework.
/**
 * WHO MAY HAVE WRITTEN EVIDENCE (spec 02 §3.3). A writer key signs seals and chain entries; it counts only if a lease
 * from a Svayam ROOT certifies it (`cnf.jwk`, RFC 7800). The verifier needs no network: the writer's public key and
 * its leases are committed at `evidence/keys/<kid>.json` ({kid, jwk, leases[]}), and the roots are SHIPPED here, with rotation recorded in
 * `evidence/keys/roots.json`.
 *
 * TRUST, in order:
 *   1. a root shipped in this verifier (SHIPPED_ROOTS, or the caller's list);
 *   2. a root in roots.json that carries an `endorsement` — a `gov-root+jws` signed by an already-trusted root
 *      naming that kid and key (how a rotation reaches an old verifier);
 *   3. a `test-*` root in roots.json, ONLY when the caller allows test roots — and the result says so loudly.
 * Anything else in roots.json is ignored: whoever can push to the evidence branch could otherwise mint a root.
 */
import { sha256Hex } from "./canonical.js";
import { isEd25519Jwk, verifyEd25519, type Ed25519Jwk } from "./hash.js";

export interface RootKey extends Ed25519Jwk { readonly kid: string }

/**
 * Svayam's published root keys. EMPTY until the gov-licence service publishes its production keyset (plan 02 E14):
 * until then only an endorsed or (explicitly allowed) test root can certify a writer.
 */
export const SHIPPED_ROOTS: readonly RootKey[] = Object.freeze([]);

/** Leases are used for signing until `exp` plus this grace (spec 02 Q10: 72 h). */
export const LEASE_GRACE_SECONDS = 72 * 3600;

export interface DecodedJws {
  readonly header: Record<string, unknown>;
  readonly claims: Record<string, unknown>;
  readonly signingInput: string;
  readonly sig: string;
}

export function decodeJws(compact: unknown): DecodedJws | null {
  if (typeof compact !== "string") return null;
  const parts = compact.split(".");
  if (parts.length !== 3 || parts.some((p) => !/^[A-Za-z0-9_-]*$/.test(p))) return null;
  try {
    const header = JSON.parse(Buffer.from(parts[0]!, "base64url").toString("utf8")) as unknown;
    const claims = JSON.parse(Buffer.from(parts[1]!, "base64url").toString("utf8")) as unknown;
    if (!header || typeof header !== "object" || !claims || typeof claims !== "object") return null;
    return { header: header as Record<string, unknown>, claims: claims as Record<string, unknown>, signingInput: `${parts[0]}.${parts[1]}`, sig: parts[2]! };
  } catch {
    // not base64url JSON: "not a JWS", which the caller reports as cert.invalid
    return null;
  }
}

export type JwsCheck =
  | { readonly ok: true; readonly jws: DecodedJws }
  | { readonly ok: false; readonly code: "malformed" | "alg" | "typ" | "unknown-kid" | "signature"; readonly reason: string; readonly kid?: string };

/** EdDSA pinned; typ must match; kid must be one of `keys`. */
export function verifyJws(compact: unknown, typ: string, keys: ReadonlyMap<string, Ed25519Jwk>): JwsCheck {
  const jws = decodeJws(compact);
  if (!jws) return { ok: false, code: "malformed", reason: "not a compact JWS" };
  if (jws.header.alg !== "EdDSA") return { ok: false, code: "alg", reason: `alg is ${String(jws.header.alg)}, not EdDSA` };
  if (jws.header.typ !== typ) return { ok: false, code: "typ", reason: `typ is ${String(jws.header.typ)}, not ${typ}` };
  const kid = typeof jws.header.kid === "string" ? jws.header.kid : "";
  const key = keys.get(kid);
  if (!key) return { ok: false, code: "unknown-kid", reason: `signed by ${kid || "(no kid)"}, which is not a trusted Svayam root`, kid };
  if (!verifyEd25519(key, jws.signingInput, jws.sig)) return { ok: false, code: "signature", reason: `signature by ${kid} does not verify`, kid };
  return { ok: true, jws };
}

export interface TrustedRoots {
  readonly keys: ReadonlyMap<string, RootKey>;
  /** Lines for the person: test roots trusted, roots.json entries ignored and why. */
  readonly notes: readonly string[];
}

/**
 * The roots this verification trusts: the shipped ones, plus roots.json entries that an already-trusted root endorsed
 * (repeated until nothing new is added, so a chain of rotations works), plus `test-*` ones when allowed.
 */
export function trustRoots(shipped: readonly RootKey[], rootsJson: unknown, opts: { trustTestRoots?: boolean } = {}): TrustedRoots {
  const keys = new Map<string, RootKey>();
  for (const k of shipped) if (isEd25519Jwk(k)) keys.set(k.kid, k);
  const notes: string[] = [];
  // `{roots: [...]}` (as gov-check writes it) or `{keys: [...]}` (a JWKS-shaped list); each entry {kid, kty, crv, x, endorsement?}.
  const rj = rootsJson as { roots?: unknown; keys?: unknown } | null;
  const listed = Array.isArray(rj?.roots) ? rj.roots : rj?.keys;
  const entries: Record<string, unknown>[] = Array.isArray(listed) ? listed.filter((e): e is Record<string, unknown> => !!e && typeof e === "object") : [];
  const pending = new Set(entries);
  for (let changed = true; changed;) {
    changed = false;
    for (const e of pending) {
      const kid = typeof e.kid === "string" ? e.kid : "";
      const jwk = { kty: e.kty, crv: e.crv, x: e.x };
      if (!kid || !isEd25519Jwk(jwk)) { pending.delete(e); notes.push(`roots.json: an entry without a valid kid and Ed25519 key was ignored`); continue; }
      const shippedSame = keys.get(kid);
      if (shippedSame) { pending.delete(e); if (shippedSame.x !== jwk.x) notes.push(`roots.json: ${kid} names a different key than the trusted one — ignored`); continue; }
      if (e.endorsement !== undefined) {
        const c = verifyJws(e.endorsement, "gov-root+jws", keys);
        if (c.ok && c.jws.claims.kid === kid && c.jws.claims.x === jwk.x) {
          keys.set(kid, { kid, ...jwk }); pending.delete(e); changed = true; continue;
        }
      }
    }
  }
  for (const e of pending) {
    const kid = e.kid as string;
    if (opts.trustTestRoots && kid.startsWith("test-")) {
      keys.set(kid, { kid, kty: "OKP", crv: "Ed25519", x: e.x as string });
      notes.push(`TEST roots trusted (${kid}) — this ledger was certified by a test issuer; it is not evidence for an auditor.`);
    } else if (kid.startsWith("test-")) {
      notes.push(`roots.json: ${kid} is a test root — not trusted (allow test roots only for a test ledger)`);
    } else {
      notes.push(`roots.json: ${kid} has no endorsement from a trusted Svayam root — ignored`);
    }
  }
  return { keys, notes };
}

/** One lease from a writer's key file that a trusted root signed for this writer's key. */
export interface CertLease {
  readonly jti: string;
  readonly nbf?: number;
  readonly exp?: number;
  readonly entitlements: readonly string[];
  /** The org the lease covers (`org.id`), when it says. */
  readonly orgId?: number;
}

export type CertCheck =
  | { readonly ok: true; readonly jwk: Ed25519Jwk; readonly leases: readonly CertLease[] }
  | { readonly ok: false; readonly code: "cert.missing" | "cert.invalid" | "cert.root" | "cert.key-mismatch"; readonly reason: string };

/** A writer kid is `wk-` + the first 24 hex characters of sha256 of the key's `x` (as gov-check derives it). */
export function writerKid(x: string): string {
  return `wk-${sha256Hex(x).slice(0, 24)}`;
}

/**
 * Is `evidence/keys/<kid>.json` ({kid, jwk, leases[]}) a writer key certified by a trusted root? Every lease is
 * checked; the ones that hold are returned (a seal then names the one it was made under by `cert` = the lease's jti).
 */
export function checkWriterCert(kid: string, keyFile: unknown, roots: TrustedRoots): CertCheck {
  if (keyFile === null || keyFile === undefined) return { ok: false, code: "cert.missing", reason: `no key file for writer ${kid}` };
  const f = keyFile as { kid?: unknown; jwk?: unknown; leases?: unknown };
  if (typeof f !== "object" || f.kid !== kid || !isEd25519Jwk(f.jwk)) return { ok: false, code: "cert.invalid", reason: `the key file does not hold writer ${kid}'s Ed25519 public key` };
  if (writerKid(f.jwk.x) !== kid) return { ok: false, code: "cert.invalid", reason: `writer ${kid} is not the kid of the key it holds (expected ${writerKid(f.jwk.x)})` };
  if (!Array.isArray(f.leases) || f.leases.length === 0) return { ok: false, code: "cert.invalid", reason: `writer ${kid}'s key file lists no leases` };
  const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
  const leases: CertLease[] = [];
  let last: { code: "cert.invalid" | "cert.root" | "cert.key-mismatch"; reason: string } = { code: "cert.invalid", reason: "" };
  for (const l of f.leases) {
    const c = verifyJws(l, "gov-lease+jws", roots.keys);
    if (!c.ok) { last = { code: c.code === "unknown-kid" || c.code === "signature" ? "cert.root" : "cert.invalid", reason: `writer ${kid}'s lease: ${c.reason}` }; continue; }
    const cnf = (c.jws.claims.cnf as { jwk?: unknown } | undefined)?.jwk;
    if (!isEd25519Jwk(cnf) || cnf.x !== f.jwk.x) { last = { code: "cert.key-mismatch", reason: `writer ${kid}'s lease certifies a different public key` }; continue; }
    const nbf = num(c.jws.claims.nbf) ?? num(c.jws.claims.iat);
    const exp = num(c.jws.claims.exp);
    const orgId = num((c.jws.claims.org as { id?: unknown } | undefined)?.id);
    const ents = Array.isArray(c.jws.claims.entitlements) ? c.jws.claims.entitlements.filter((e): e is string => typeof e === "string") : [];
    leases.push({
      jti: typeof c.jws.claims.jti === "string" ? c.jws.claims.jti : "",
      entitlements: ents,
      ...(nbf !== undefined ? { nbf } : {}), ...(exp !== undefined ? { exp } : {}), ...(orgId !== undefined ? { orgId } : {}),
    });
  }
  if (!leases.length) return { ok: false, ...last };
  return { ok: true, jwk: f.jwk, leases };
}

/** The key file name for a writer kid (kids may hold `:` or `/`, which a file name cannot). */
export function keyFileName(kid: string): string {
  return `${encodeURIComponent(kid)}.json`;
}

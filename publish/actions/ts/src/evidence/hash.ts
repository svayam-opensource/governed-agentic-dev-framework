// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd. — part of the OSS governed-agentic-dev-framework.
/**
 * THE LEDGER'S HASHES AND SIGNATURES (spec 02 §3.2) — what a writer signs and what the verifier re-computes. One
 * implementation, used by the free verifier here and handed to the paid writer (gov-check) through the check host, so
 * the bytes signed and the bytes checked can never come from two codebases.
 *
 *   line hash   h_i   = sha256(canonical JSON of record line i)                       (32 raw bytes)
 *   seal.root         = sha256(h_1 ‖ h_2 ‖ … ‖ h_n)                                    (hex)
 *   seal.sig          = Ed25519, base64url, over canonical JSON of the seal WITHOUT sig
 *   entry.sha256      = sha256 of the segment FILE bytes                              (hex)
 *   entry.prev        = sha256 of canonical JSON of the previous entry, sig included   (hex; 64 zeros for the first)
 *   entry.sig         = Ed25519, base64url, over canonical JSON of the entry WITHOUT sig
 */
import { createHash, createPublicKey, verify as edVerify, type KeyObject } from "node:crypto";
import { canonicalJson, sha256Hex } from "./canonical.js";

/** `prev` of the very first chain entry ever written. */
export const ZERO_HASH = "0".repeat(64);

/** h_i: the raw 32-byte SHA-256 of a record's canonical JSON. */
export function lineDigest(record: unknown): Buffer {
  return createHash("sha256").update(canonicalJson(record)).digest();
}

/** seal.root over the records of a segment, in file order. */
export function segmentRoot(records: readonly unknown[]): string {
  const h = createHash("sha256");
  for (const r of records) h.update(lineDigest(r));
  return h.digest("hex");
}

const withoutSig = (o: Record<string, unknown>): Record<string, unknown> => {
  const { sig: _sig, ...rest } = o;
  return rest;
};

/** The exact text a writer signs for a seal (the seal object, `sig` left out). */
export function sealPayload(seal: Record<string, unknown>): string {
  return canonicalJson(withoutSig(seal));
}

/** The exact text a writer signs for a chain entry (`sig` left out). */
export function entryPayload(entry: Record<string, unknown>): string {
  return canonicalJson(withoutSig(entry));
}

/** What the NEXT entry's `prev` must be: the hash of this whole entry, signature included. */
export function entryHash(entry: Record<string, unknown>): string {
  return sha256Hex(canonicalJson(entry));
}

/** entry.sha256: the hash of a segment file exactly as stored. */
export function fileHash(bytes: Uint8Array): string {
  return sha256Hex(bytes);
}

/** An Ed25519 public key as a JWK (`kty: OKP`, `crv: Ed25519`, `x` base64url). */
export interface Ed25519Jwk { readonly kty: "OKP"; readonly crv: "Ed25519"; readonly x: string }

export function isEd25519Jwk(v: unknown): v is Ed25519Jwk {
  const j = v as Partial<Ed25519Jwk> | null;
  return !!j && typeof j === "object" && j.kty === "OKP" && j.crv === "Ed25519" && typeof j.x === "string" && /^[A-Za-z0-9_-]{43}$/.test(j.x);
}

export function publicKeyFromJwk(jwk: Ed25519Jwk): KeyObject {
  return createPublicKey({ key: { kty: "OKP", crv: "Ed25519", x: jwk.x }, format: "jwk" });
}

/** Does `sig` (base64url) verify `payload` (UTF-8 text) under this Ed25519 key? Never throws. */
export function verifyEd25519(jwk: Ed25519Jwk, payload: string | Uint8Array, sig: string): boolean {
  try {
    if (!/^[A-Za-z0-9_-]+$/.test(sig)) return false;
    return edVerify(null, typeof payload === "string" ? Buffer.from(payload, "utf8") : payload, publicKeyFromJwk(jwk), Buffer.from(sig, "base64url"));
  } catch {
    // a malformed key or signature is simply "does not verify" — the caller names the break
    return false;
  }
}

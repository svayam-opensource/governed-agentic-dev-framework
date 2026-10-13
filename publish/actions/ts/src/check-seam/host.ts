// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd. — part of the OSS governed-agentic-dev-framework.
/**
 * Builds the {@link Host} object gov hands a paid module at activation (spec 02 §5). Only runtime helpers cross:
 * the ledger's one canonicaliser and hash, the seam schemas, the keychain port, quiet logging, and (API 1.1) the
 * ledger helpers the free verifier runs, so the writer signs exactly what `gov evidence verify` checks.
 *
 * The keychain defaults to "none": the real OS keychain port arrives with `gov licence login` (plan 02 E05) and is
 * passed in by the caller; until then a module that asks for a stored key gets null, and a write is refused plainly.
 */
import { canonicalJson, sha256Hex } from "../evidence/canonical.js";
import { entryHash, entryPayload, fileHash, lineDigest, sealPayload, segmentRoot, verifyEd25519, ZERO_HASH } from "../evidence/hash.js";
import { keyFileName, writerKid } from "../evidence/roots.js";
import { dirSource, verifyLedger } from "../evidence/verify.js";
import { HOST_API, type Host, type HostLog, type KeychainPort, type LedgerHelpers } from "./public.js";
import { validate } from "./validate.js";

export const NO_KEYCHAIN: KeychainPort = {
  backend: "none",
  get: () => Promise.resolve(null),
  set: () => Promise.reject(new Error("no keychain is available here — set GOV_LICENCE_KEY in the environment instead")),
  delete: () => Promise.resolve(),
};

const LEDGER: LedgerHelpers = Object.freeze({
  ZERO_HASH, lineDigest, segmentRoot, sealPayload, entryPayload, entryHash, fileHash, verifyEd25519, keyFileName, writerKid, verifyLedger, dirSource,
});

const SILENT: HostLog = { info: () => undefined, warn: () => undefined, debug: () => undefined };

export function createHost(opts: { govVersion: string; keychain?: KeychainPort; log?: HostLog }): Host {
  return Object.freeze({
    api: HOST_API,
    govVersion: opts.govVersion,
    canonicalJson,
    sha256Hex,
    validate,
    keychain: opts.keychain ?? NO_KEYCHAIN,
    log: opts.log ?? SILENT,
    ledger: LEDGER,
  });
}

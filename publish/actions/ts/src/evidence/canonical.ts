// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd. — part of the OSS governed-agentic-dev-framework.
/**
 * THE canonical JSON of the evidence ledger (spec 02 §3.2) — the ONE implementation. Every line hash, seal root, seal
 * signature and chain-entry signature is computed over these bytes, by the closed writer (gov-check, which receives
 * this function through the check host) and by the free verifier (`gov evidence verify`). Two implementations would
 * be two ledgers.
 *
 * RFC 8785 (JCS) restricted to what a record holds: object keys sorted by UTF-16 code units, no whitespace, strings
 * escaped as `JSON.stringify` does, and INTEGERS ONLY (safe range). A fraction, NaN, Infinity, undefined, a function
 * or a bigint has no single agreed form here, so it is refused — never silently changed.
 */
import { createHash } from "node:crypto";

export function canonicalJson(value: unknown): string {
  return enc(value, "$");
}

function enc(v: unknown, at: string): string {
  if (v === null) return "null";
  switch (typeof v) {
    case "boolean":
      return v ? "true" : "false";
    case "string":
      return JSON.stringify(v);
    case "number":
      if (!Number.isSafeInteger(v)) throw new Error(`canonical JSON: ${at} is ${v} — only safe integers have a canonical form here.`);
      return JSON.stringify(v);
    case "object": {
      if (Array.isArray(v)) return `[${v.map((x, i) => enc(x, `${at}[${i}]`)).join(",")}]`;
      const o = v as Record<string, unknown>;
      const keys = Object.keys(o).sort();
      return `{${keys.map((k) => `${JSON.stringify(k)}:${enc(o[k], `${at}.${k}`)}`).join(",")}}`;
    }
    default:
      throw new Error(`canonical JSON: ${at} is ${typeof v} — it has no canonical form.`);
  }
}

/** Lower-case hex SHA-256 of UTF-8 text or raw bytes. */
export function sha256Hex(data: string | Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}

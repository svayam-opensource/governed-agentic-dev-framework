// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * THE PRIVATE NODE, and how it is trusted (spec 04 §4.2, ruling Q4 A). The MSI carries nodejs.org's own Windows
 * zip for the target arch, unchanged. The zip is checked against the SHASUMS256.txt published beside it before a
 * single file is unpacked; a mismatch fails the build. (The `.asc` signature on SHASUMS256.txt is deferred — Q16.)
 */
import { createHash } from "node:crypto";

/** The Windows architectures the MSI ships for (plan 04, decision 4: both). */
export const NODE_ARCHES = Object.freeze(["x64", "arm64"]);

/** `v24.21.0` / `24.21.0` → `v24.21.0`; anything but Node 24 is refused (AD-6.1). */
export function normalizeNodeVersion(v) {
  const m = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(String(v).trim());
  if (!m) throw new Error(`not a Node version: ${v}`);
  if (m[1] !== "24") throw new Error(`the MSI carries Node 24; ${v} is not Node 24`);
  return `v${m[1]}.${m[2]}.${m[3]}`;
}

export function assertArch(arch) {
  if (!NODE_ARCHES.includes(arch)) throw new Error(`arch must be one of ${NODE_ARCHES.join(", ")}; got ${arch}`);
  return arch;
}

export function nodeZipName(version, arch) {
  assertArch(arch);
  return `node-${normalizeNodeVersion(version)}-win-${arch}.zip`;
}

export function nodeDistUrl(version, file) {
  return `https://nodejs.org/dist/${normalizeNodeVersion(version)}/${file}`;
}

/** SHASUMS256.txt → Map(file name → lower-case hex sha256). */
export function parseShasums(text) {
  const m = new Map();
  for (const line of String(text).split(/\r?\n/)) {
    const hit = /^([0-9a-fA-F]{64})\s+\*?(\S+)\s*$/.exec(line);
    if (hit) m.set(hit[2], hit[1].toLowerCase());
  }
  return m;
}

export function sha256(buf) {
  return createHash("sha256").update(buf).digest("hex");
}

/** Throws unless `buf` hashes to what SHASUMS256.txt lists for `name`. */
export function verifyChecksum(buf, name, shasums) {
  const want = shasums.get(name);
  if (!want) throw new Error(`checksum: ${name} is not listed in SHASUMS256.txt — refusing to use an archive nothing vouches for`);
  const got = sha256(buf);
  if (got !== want) {
    throw new Error(`checksum mismatch for ${name}: SHASUMS256.txt says ${want}, the download hashes to ${got} — refusing to build`);
  }
  return got;
}

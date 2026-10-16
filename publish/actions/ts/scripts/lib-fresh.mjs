// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * IS lib/ THE BUILD OF THIS src/? (PRJ-121 intent 05, Item 7a)
 *
 * `npm test` runs src/ through tsx and builds nothing, yet a few tests and both e2e harnesses (journey.sh,
 * adopter-smoke.sh) run the COMPILED lib/. They used to build only when lib/ was missing, so a lib/ compiled before
 * the last src/ change was run silently — a test went green on code that was no longer the code.
 *
 *   node scripts/lib-fresh.mjs --write   postbuild: record a sha256 over src/** and tsconfig*.json (path + bytes)
 *                                        in lib/source-fingerprint.json, beside lib/build-identity.json
 *   node scripts/lib-fresh.mjs           recompute and compare:
 *                                          exit 0  fresh
 *                                          exit 1  stale  "lib/ is stale — npm run build" (also: no fingerprint)
 *                                          exit 2  absent (no lib/ at all — a pure unit run that never built)
 *   --root <dir>                         the package root (default: this script's package)
 *
 * Content, not mtime: a checkout or a `touch` that changes no byte is not a change; an edit, an added or a removed
 * file is.
 */
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

export const FINGERPRINT_PATH = "lib/source-fingerprint.json";
export const STALE_MESSAGE = "lib/ is stale — npm run build";

function walk(dir, rel, out) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) walk(path.join(dir, e.name), r, out);
    else if (e.isFile()) out.push(r);
  }
}

/** sha256 over every file of src/** and every tsconfig*.json at the root: sorted, path and bytes. */
export function sourceFingerprint(root) {
  const files = [];
  if (fs.existsSync(path.join(root, "src"))) walk(path.join(root, "src"), "src", files);
  for (const f of fs.readdirSync(root)) if (/^tsconfig.*\.json$/.test(f)) files.push(f);
  files.sort();
  const h = createHash("sha256");
  for (const f of files) {
    h.update(f).update("\0");
    h.update(fs.readFileSync(path.join(root, f))).update("\0");
  }
  return `sha256:${h.digest("hex")}`;
}

/** { state: "fresh" | "stale" | "absent", message } */
export function libFreshness(root) {
  if (!fs.existsSync(path.join(root, "lib"))) return { state: "absent", message: "no lib/ — npm run build to use the compiled gov" };
  let recorded = null;
  try { recorded = JSON.parse(fs.readFileSync(path.join(root, FINGERPRINT_PATH), "utf8")).sources ?? null; }
  catch { recorded = null; /* no fingerprint (a lib/ built before this check) or unreadable: never trusted */ }
  if (recorded === null) return { state: "stale", message: `${STALE_MESSAGE} (lib/ records no source fingerprint)` };
  if (recorded !== sourceFingerprint(root)) return { state: "stale", message: `${STALE_MESSAGE} (src/ changed since lib/ was built)` };
  return { state: "fresh", message: "lib/ is fresh" };
}

export function writeFingerprint(root) {
  fs.mkdirSync(path.join(root, "lib"), { recursive: true });
  fs.writeFileSync(path.join(root, FINGERPRINT_PATH), JSON.stringify({ sources: sourceFingerprint(root) }, null, 2) + "\n");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const i = args.indexOf("--root");
  const root = path.resolve(i >= 0 ? args[i + 1] : path.join(path.dirname(fileURLToPath(import.meta.url)), ".."));
  if (args.includes("--write")) { writeFingerprint(root); process.exit(0); }
  const { state, message } = libFreshness(root);
  // STDERR only: this can run inside an npm lifecycle whose stdout another tool parses (see write-build-identity.mjs).
  console.error(message);
  process.exit(state === "fresh" ? 0 : state === "absent" ? 2 : 1);
}

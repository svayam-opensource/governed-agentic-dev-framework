// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * tsc does not copy JSON: put the check-seam schemas (src/check-seam/schemas/*.schema.json) beside the compiled
 * modules in BOTH builds, where `schemas.ts` reads them and `@svayam-opensource/gov/check-host/schemas/*` points.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const src = path.join(root, "src", "check-seam", "schemas");
for (const out of ["esm", "cjs"]) {
  const dst = path.join(root, "lib", out, "check-seam", "schemas");
  fs.mkdirSync(dst, { recursive: true });
  for (const f of fs.readdirSync(src).filter((n) => n.endsWith(".schema.json"))) fs.copyFileSync(path.join(src, f), path.join(dst, f));
}

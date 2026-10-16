// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
//
// For tests that run the COMPILED lib/ (PRJ-121 intent 05, Item 7a): ask scripts/lib-fresh.mjs whether lib/ is
// the build of this src/. Absent → the test skips (a pure unit run never built); stale → the test FAILS, naming it.
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const SCRIPT = fileURLToPath(new URL("../../scripts/lib-fresh.mjs", import.meta.url));
export const PKG_ROOT = fileURLToPath(new URL("../../", import.meta.url));

export type LibState = "fresh" | "stale" | "absent";

export function libFreshness(root: string = PKG_ROOT): { state: LibState; message: string } {
  const r = spawnSync(process.execPath, [SCRIPT, "--root", root], { encoding: "utf8" });
  const message = (r.stderr ?? "").trim();
  if (r.status === 0) return { state: "fresh", message };
  if (r.status === 2) return { state: "absent", message };
  return { state: "stale", message: message || `lib-fresh exited ${r.status}` };
}

/** In a mocha `before`/`it`: skip when lib/ was never built; throw (fail) when it is stale. */
export function requireFreshLib(ctx: Mocha.Context, root: string = PKG_ROOT): void {
  const { state, message } = libFreshness(root);
  if (state === "absent") ctx.skip();
  if (state === "stale") throw new Error(message);
}

// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * The `gh` runner the GitHub adapters share (PRJ-121 intent 03). INJECTABLE, so a unit test hands the adapter a
 * fake and never needs `gh`, a token or the network. It never throws for a failed call: it answers with the exit
 * status and what gh printed, and {@link ghJson} turns that into a {@link Result} with a reason a person can read.
 *
 * Goes through `run-process.ts`, so every call is in the run log (GOV-FRM-423).
 */
import { runResult } from "../../run-process.js";
import { isTransientGhError } from "../../lifecycle/gh-board.js";
import { fail, ok, type Result } from "../../ports/result.js";

export interface GhReply { readonly status: number; readonly stdout: string; readonly stderr: string }
/** Run `gh <args>`. May throw only when gh cannot be started at all; {@link ghCall} accounts for that. */
export type GhRun = (args: readonly string[]) => GhReply;

export const defaultGhRun: GhRun = (args) => runResult("gh", args, { pgm: "gov-work:adapters:github", fn: "gh" });

/** True when GitHub said "not found" — for a branch, an answer; for most things, a failure. */
export const isNotFound = (r: GhReply): boolean => r.status !== 0 && /\(HTTP 404\)|\bnot found\b/i.test(r.stderr);

/** Run gh; a spawn failure becomes a failed reply rather than an exception. */
export function ghCall(gh: GhRun, args: readonly string[]): GhReply {
  try { return gh(args); } catch (e) { return { status: -1, stdout: "", stderr: `could not run gh: ${(e as Error).message}` }; }
}

/** A failed reply as a {@link Result}: gh's first meaningful line(s) as the reason, retryable when transient. */
export function ghFailure(r: GhReply, what: string): Result<never> {
  const said = r.stderr.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).join(" — ").slice(0, 300) || `gh exited ${r.status} with no message`;
  return fail(`${what}: ${said}`, isTransientGhError({ stderr: r.stderr }));
}

/** Run gh and parse its stdout as JSON. */
export function ghJson<T>(gh: GhRun, args: readonly string[], what: string): Result<T> {
  const r = ghCall(gh, args);
  if (r.status !== 0) return ghFailure(r, what);
  try { return ok(JSON.parse(r.stdout) as T); } catch (e) {
    return fail(`${what}: GitHub's answer was not JSON (${(e as Error).message.slice(0, 80)})`);
  }
}

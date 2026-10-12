// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * WHAT EVERY PORT CALL RETURNS (PRJ-121 intent 03, spec §6).
 *
 * gov learned the port pattern from gov-cicd, with one difference: NO SILENT BEST-EFFORT. `setBoardStatus` was a
 * no-op for months (`lifecycle/issues.ts`) because nothing made its caller look at the outcome. A port call
 * returns a `Result`, and the caller must branch on `ok` before it can reach the value — a failure carries the
 * reason a person can read and whether trying again could help.
 */
export type Result<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly reason: string; readonly retryable: boolean };

/** A success carrying `value`. */
export const ok = <T>(value: T): Result<T> => ({ ok: true, value });

/** A failure: `reason` is for a person; `retryable` says whether the same call could succeed later. */
export const fail = (reason: string, retryable = false): Result<never> => ({ ok: false, reason, retryable });

/** Narrow a result to its success branch. */
export const isOk = <T>(r: Result<T>): r is { readonly ok: true; readonly value: T } => r.ok;

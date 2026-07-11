// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * The validation-suite harness (SDD-032, Part C) — Python `validate/*.py` → Node.
 * Each validator is a pure function of a small context; `runValidators` runs them
 * and aggregates. This is the machinery behind `gov-work validate` and the close /
 * publish gates (a non-empty result = hard fail).
 */
import type { Fs } from "../lifecycle/fs-io.js";

/** The result of one validator. */
export interface ValidationResult {
  readonly name: string;
  readonly ok: boolean;
  readonly errors: readonly string[];
}

/** What a validator reads. */
export interface ValidateContext {
  readonly fs: Fs;
  /** Absolute repo root the validator inspects. */
  readonly repoRoot: string;
  /** Repo-relative tracked files (e.g. from `git ls-files`); used by file scanners. */
  readonly files?: readonly string[];
}

/** A single check. Pure over the context. */
export type Validator = (ctx: ValidateContext) => ValidationResult;

/** Aggregate outcome of a validation run. */
export interface ValidationRun {
  readonly ok: boolean;
  readonly results: readonly ValidationResult[];
  /** Flattened `"<name>: <error>"` lines for all failures. */
  readonly failures: readonly string[];
}

/** Run every validator and aggregate; `ok` is true only if all passed. */
export function runValidators(ctx: ValidateContext, validators: readonly Validator[]): ValidationRun {
  const results = validators.map((v) => v(ctx));
  const failures = results.flatMap((r) => r.errors.map((e) => `${r.name}: ${e}`));
  return { ok: results.every((r) => r.ok), results, failures };
}

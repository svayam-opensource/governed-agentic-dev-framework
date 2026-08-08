// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * Path helpers for the test doubles — the reason 83 tests failed the first time this suite ran on Windows.
 *
 * The production code is correct: it composes paths with `path.join`, which yields `a\b` on Windows and
 * `a/b` elsewhere. The TESTS were not: every fake filesystem keys on POSIX literals (`/work/PRJ-7`), so on
 * Windows the lookup misses and the assertion reports something misleading — `expected 'not-seeded' to
 * equal 'not-cloned'`, or `expected false to equal true`. The defect was never in what the code did with a
 * path; it was that the double could not recognise the path it was handed.
 *
 * `px` normalises at the DOUBLE'S BOUNDARY, so a test can keep saying `/work/PRJ-7` — which is what it
 * means — while still recognising `\work\PRJ-7`. On POSIX it is the identity function, so nothing about the
 * existing runs changes.
 *
 * Use `px` on the value CROSSING the boundary (what the fake receives, or what an assertion compares), not
 * inside production code. If production ever needs it, that is a real bug, not a test-fixture concern.
 */

/** Normalise separators for comparison: `a\b` → `a/b`. Identity on POSIX. */
export const px = (p: string): string => p.replace(/\\/g, "/");

/** Normalise every path in a list — for assertions that compare produced paths against POSIX literals. */
export const pxAll = (ps: readonly string[]): string[] => ps.map(px);

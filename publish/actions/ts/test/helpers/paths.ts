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

/**
 * Also undo the DRIVE LETTER. `path.resolve("/gov")` is `/gov` on POSIX but `D:\\gov` on Windows — whatever
 * drive the checkout happens to sit on. A test that writes `/gov` means "a rooted path", not "a path on D:",
 * so a double keyed on `/gov` should still recognise it. The pattern also matches a path embedded in a
 * message (`Registered Svayamtech → D:/gov`), which is where these show up most.
 *
 * Identity on POSIX: nothing there produces an `X:/` prefix.
 */
export const pxAbs = (s: string): string => px(s).replace(/(^|[\s'"(→=])[A-Za-z]:\//g, "$1/");

/** Normalise every path in a list — for assertions that compare produced paths against POSIX literals. */
export const pxAll = (ps: readonly string[]): string[] => ps.map(px);

/**
 * Normalise every string inside a value — arrays, objects, nested. For assertions that compare a whole
 * structure of produced paths against POSIX literals, where wrapping each element would be noise.
 *
 * Uses `pxAbs`, so a resolved `D:\\work\\PRJ-7` still matches the `/work/PRJ-7` the test wrote.
 *
 * Use it on the ACTUAL, never to build an expectation: an expectation that has been normalised asserts
 * nothing about separators, and one day that will matter.
 */
export function pxDeep<T>(v: T): T {
  if (typeof v === "string") return pxAbs(v) as unknown as T;
  if (Array.isArray(v)) return v.map(pxDeep) as unknown as T;
  if (v && typeof v === "object") {
    return Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, pxDeep(x)])) as T;
  }
  return v;
}

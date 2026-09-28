// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * THE ONE GLOB MATCHER, because a check's `when=` and `require=` are globs and gov has no glob library.
 *
 * gov carries exactly one runtime dependency, so this is hand-rolled — and deliberately SMALL. The grammar is
 * what a policy author actually writes in a `gov:check`: `**` for any depth, `*` within a segment, `?` for one
 * character, a literal `.`, and nothing else. No braces, no character classes, no negation.
 *
 * A LARGER GRAMMAR WOULD BE WORSE, not better. Every pattern feature is a way for an organization to write a
 * check that matches something other than what they meant — and a check that quietly matches nothing is the
 * defect this whole design keeps running into: a rule that reads as enforced and is not. Six constructs can be
 * explained in one line of documentation and verified by eye.
 *
 * Paths are compared with forward slashes, always. A caller on Windows normalises before it gets here; doing it
 * inside would hide the conversion from the tests that need to prove it happens.
 */

/** Escape everything with meaning in a regular expression EXCEPT the glob characters we interpret. */
const escapeLiteral = (s: string): string => s.replace(/[.+^${}()|[\]\\]/g, "\\$&");

/**
 * Compile a glob to an anchored regular expression.
 *
 * `**` and `*` are ordered carefully: `**\/` must consume the slash so that `src/**\/*.ts` matches `src/a.ts`
 * as well as `src/deep/a.ts`. Written the obvious way — `*` → `[^/]*` then `**` → `.*` — a pattern like
 * `src/**` matches `src/a` but not `src/` itself, and `**\/x` fails to match a top-level `x`. Both were wrong
 * in ways nobody notices until a check silently matches nothing.
 */
export function globToRegExp(glob: string): RegExp {
  let out = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i]!;
    if (c === "*") {
      const doubled = glob[i + 1] === "*";
      if (doubled) {
        // `**/` swallows the separator too, so the pattern matches zero intermediate directories.
        if (glob[i + 2] === "/") { out += "(?:.*/)?"; i += 2; } else { out += ".*"; i += 1; }
      } else {
        out += "[^/]*";
      }
    } else if (c === "?") {
      out += "[^/]";
    } else {
      out += escapeLiteral(c);
    }
  }
  return new RegExp(`^${out}$`);
}

/** Does `path` match `glob`? */
export const matchesGlob = (path: string, glob: string): boolean => globToRegExp(glob).test(path);

/** Does `path` match any of `globs`? An empty list matches NOTHING — never everything (see below). */
export const matchesAny = (path: string, globs: readonly string[]): boolean =>
  globs.some((g) => matchesGlob(path, g));

/**
 * The paths in `paths` that match any glob in `globs`.
 *
 * AN EMPTY GLOB LIST MATCHES NOTHING. The alternative — treating "no globs" as "all paths" — is the friendlier
 * reading and the dangerous one: a check whose `when=` was forgotten would suddenly apply to every file in the
 * repository and fail everything, or (for a `require`) pass vacuously. Matching nothing makes the mistake
 * visible at the first run instead of surprising somebody later.
 */
export const filterByGlobs = (paths: readonly string[], globs: readonly string[]): string[] =>
  paths.filter((p) => matchesAny(p, globs));

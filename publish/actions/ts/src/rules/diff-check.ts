// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 THE CHECKS THAT NOTHING EVALUATED (PRJ-121, 2026-09-28) — now the changeset half of the `gov-builtin` predicates.
 *
 * A check has two triggers: a VERB (`gov.verb · close`), evaluated by {@link ./verb-gate.js}, and a CHANGESET
 * (`vcs.* · pull_request`, narrowed by `when:` globs). The second was once parsed, validated, and rendered
 * byte-stably into every harness — and evaluated by NOTHING. So the seeded org policy's technology clause
 * ("a library not listed in `approved-technologies.md` MAY be introduced only with an approved exception") never
 * ran on a single pull request, and 92 of the framework's 107 rules were advisory while reading as checked.
 *
 * That is GOV-FRM-402's false authority in the worst possible place: a rule that reads as enforced and is not. Worse
 * than an absent check, because an absent check is visible in `gov doctor`'s advisory column, while this one sat
 * in the CHECKED column and in the agent's resident cue, telling everybody it had teeth.
 *
 * This module is the missing evaluator. It is PURE over an injected CHANGESET and an injected `read` for the one
 * document a check may point at (`list=`):
 *
 *   - a gate that needed a real repository to exercise would be tested once, by hand, at the point where it is
 *     most expensive to get wrong — and the fixtures in `test/rules/diff-check.fixtures.test.ts` are the only
 *     evidence any of these predicates does anything at all;
 *   - the clauses and the referenced list MUST come from the RATIFIED branch, never from the branch under review
 *     (GOV-FRM-456 and GOV-FRM-086 — otherwise a pull request can weaken the rule that judges it). That decision belongs in
 *     `src/cli/diff-check-io.ts` where it is visible; reading a path from disk in here would hide it.
 *
 * Findings are verb-gate's {@link GateFinding}, unchanged: one reporting shape, one message style, one formatter.
 */
import { filterByGlobs, matchesAny } from "./glob.js";
import type { Check } from "./checks/predicates.js";
import type { AttachedCheck, GateFinding, GateResult } from "./verb-gate.js";

/** What happened to a file in the changeset. A rename arrives as a deletion of the old path plus an added new one. */
export type ChangeStatus = "added" | "modified" | "deleted";

/**
 * One file in the changeset under review.
 *
 * `addedLines` is separate from `text` because TWO predicates are about what a diff ADDED, not about what the
 * file now contains. `content-forbidden` is the clear case: if it read the whole file, a planted key committed
 * last year would fail every unrelated pull request that touches that file, and the third time that happens
 * somebody switches the check off. Blocking on what YOU added is a rule a developer can act on.
 *
 * `text` is the file at the head of the change, or `null` when it could not be read — a deletion, or a git that
 * would not answer. `null` is a NOTED ABSENCE, never a pass: see the table in {@link runDiffChecks}.
 */
export interface ChangedFile {
  readonly path: string;
  readonly status: ChangeStatus;
  /** The `+` lines of the diff, with the marker stripped. Empty for a deletion. */
  readonly addedLines: readonly string[];
  /** The whole file at the head of the change, or null (deleted, or unreadable). */
  readonly text: string | null;
}

/**
 * The few facts about a changeset that are not a file.
 *
 * Only the branch, so far, and only because `kind=naming subject=branch` is a real clause an organization writes
 * ("a branch MUST be named `BRNCH-<n>-<slug>`") and the changeset is the only moment a pull request can be judged
 * on it. Injected rather than read, for the same reason as everything else here.
 */
export interface DiffContext {
  readonly branch?: string;
}

/** Supplies a document a check REFERS to (`list=policies/approved-technologies.md`). Null when unreadable. */
export type ReadDoc = (path: string) => string | null;

/**
 * Of a set of attached checks, the file-triggered ones whose globs match at least one changed path.
 *
 * Matching is over EVERY changed path including deletions, because two predicates (`path-scope`, `file-required`)
 * are about which paths a change touches, and deleting a file outside your writable scope is exactly the write
 * you were not allowed to make.
 */
export function selectFileChecks(checks: readonly AttachedCheck[], changed: readonly ChangedFile[]): AttachedCheck[] {
  const paths = changed.map((c) => c.path);
  return checks.filter((a) => a.check.trigger.on === "files" && filterByGlobs(paths, a.check.trigger.globs).length > 0);
}

const attr = (c: Check, key: string): string => c.attrs[key] ?? "";
const list = (c: Check, key: string): string[] => attr(c, key).split(",").map((s) => s.trim()).filter(Boolean);

/** The files a content predicate may look INSIDE: matching, and still present. See the deletion rule. */
const liveMatches = (changed: readonly ChangedFile[], globs: readonly string[]): ChangedFile[] =>
  changed.filter((f) => f.status !== "deleted" && matchesAny(f.path, globs));

/** Everything with meaning in a regular expression, escaped — for matching a dependency NAME literally. */
const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * A pattern from a policy attribute, compiled — or null, with the reason, when the author wrote a bad one.
 *
 * NEVER A THROW. One organization's typo in one `pattern=` must not abort the evaluation of every other check in
 * the pull request: that would turn a bad regular expression into "no checks ran", which is the silence this
 * whole module exists to end.
 */
function compile(pattern: string, flags: string): { re: RegExp } | { error: string } {
  try {
    return { re: new RegExp(pattern, flags) };
  } catch (e) {
    // The error is reported to the caller as a warning finding — that is the account of it.
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

// ── dependency-name parsing ──────────────────────────────────────────────────────────────────────────────────
//
// CONSERVATIVE ON PURPOSE, AND THIS IS THE MOST IMPORTANT COMMENT IN THE FILE. A name we cannot parse is NOT a
// violation. `list-membership` is the one predicate that has to read somebody else's file format, and a false
// failure on a manifest we misread — a pom's own `<artifactId>`, an `engines.node` entry read as a package — does
// not produce a careful bug report. It produces a pull request blocked for a reason nobody can act on, and then
// `on_miss=warn`, and then the check deleted. Under-reporting loses one violation; over-reporting loses the check.

/** npm keys that are NOT dependencies, however version-like their value looks. `version` and `engines.node` are why. */
const NPM_NON_DEPENDENCY_KEYS = new Set([
  "name", "version", "description", "main", "module", "types", "typings", "license", "author", "homepage",
  "bugs", "repository", "private", "packagemanager", "directory", "access", "registry", "type", "bin",
  "node", "npm", "pnpm", "yarn", "bun", "deno",
]);

/** A value that could be a dependency specifier: a range, or one of npm's protocols. Anything else is not one. */
const NPM_SPEC = /^(?:[\^~]|[><]=?|=|\*$|\d|npm:|workspace:|file:|link:|portal:|git\+|github:)/;

/** `<artifactId>x</artifactId>`, anywhere on a line. */
const POM_ARTIFACT = /<artifactId>\s*([^<\s]+)\s*<\/artifactId>/g;

/**
 * The artifactIds that sit INSIDE a `<dependency>` element, from the whole file.
 *
 * Without this, a newly added `pom.xml` fails its own technology check on the project's own `<artifactId>` — the
 * module is not in the approved list and never will be. A `-U0` hunk cannot show the enclosing element, so the
 * scope comes from the whole text and the added lines say which of those names are NEW.
 */
function pomDependencyArtifacts(text: string): Set<string> {
  const out = new Set<string>();
  let depth = 0;
  for (const line of text.split(/\r?\n/)) {
    if (/<dependency>/.test(line)) depth++;
    if (depth > 0) for (const m of line.matchAll(POM_ARTIFACT)) out.add(m[1]!);
    if (/<\/dependency>/.test(line)) depth = Math.max(0, depth - 1);
  }
  return out;
}

/** Which manifest grammar a path uses, or null — and null means this file contributes NO names. */
function manifestKind(path: string): "npm" | "go" | "maven" | "pip" | null {
  const base = path.split("/").pop() ?? path;
  if (base === "package.json") return "npm";
  if (base === "go.mod") return "go";
  if (base === "pom.xml") return "maven";
  if (/^requirements[\w.-]*\.txt$/.test(base)) return "pip";
  return null;
}

/**
 * The dependency names ADDED to `file`, in whichever of the four manifest formats it is.
 *
 * Exported because it is the part most likely to be wrong on a manifest nobody here has seen, and a reader
 * deciding whether to trust the technology check should be able to read this one function and the fixtures beside it.
 */
export function addedDependencies(file: ChangedFile): string[] {
  const kind = manifestKind(file.path);
  if (!kind) return []; // an unrecognised manifest: no names, therefore no violation. Deliberate.
  const names: string[] = [];

  for (const line of file.addedLines) {
    switch (kind) {
      case "npm":
        // `"left-pad": "^1.3.0"` — a quoted key whose value looks like a specifier. The JSON structure is
        // invisible in a `-U0` hunk, so the key deny-list above does the work `devDependencies` vs `engines`
        // would otherwise do.
        for (const m of line.matchAll(/"([^"\s]+)"\s*:\s*"([^"]*)"/g)) {
          const [, key, value] = m as unknown as [string, string, string];
          if (NPM_NON_DEPENDENCY_KEYS.has(key.toLowerCase())) continue;
          if (!NPM_SPEC.test(value)) continue;
          names.push(key);
        }
        break;
      case "go": {
        // `github.com/foo/bar v1.2.3`, bare or inside a `require (…)` block. An `// indirect` requirement is a
        // transitive one nobody in this pull request chose, so it is not judged as a technology decision.
        if (/\/\/\s*indirect/.test(line)) break;
        const m = /^\s*(?:require\s+)?([a-z0-9][\w~+-]*(?:\.[\w~+-]+)+(?:\/[\w.~+-]+)*)\s+v[\w.+-]+/i.exec(line);
        // The dotted first segment is what keeps `module …`, `go 1.22`, `replace … => …` and `exclude …` out:
        // in each the first token has no dot, and the name must start at the beginning of the line.
        if (m) names.push(m[1]!);
        break;
      }
      case "maven":
        for (const m of line.matchAll(POM_ARTIFACT)) names.push(m[1]!);
        break;
      case "pip": {
        // `name==1.2.3`, `name>=1.0`, `name[extra]==1.0`, `name; python_version<"3.12"`, or a bare `name`.
        if (/^\s*(?:#|-)/.test(line) || !line.trim()) break;
        const m = /^\s*([A-Za-z0-9][A-Za-z0-9._-]*)\s*(?:\[[^\]]*\])?\s*(.*)$/.exec(line);
        if (!m) break;
        // The remainder must LOOK like a requirement's tail. Prose, a stray word, a `--hash` on its own line:
        // not parsed, not reported.
        if (!/^(?:$|[=<>!~;@].*)/.test(m[2]!.trim())) break;
        names.push(m[1]!);
        break;
      }
    }
  }

  // Maven only: keep the names the whole file shows inside a `<dependency>`. With no text to read the scope
  // from, nothing is claimed — the conservative half of the rule, applied where it costs a missed finding
  // rather than a false one.
  if (kind === "maven") {
    if (file.text === null) return [];
    const scoped = pomDependencyArtifacts(file.text);
    return names.filter((n) => scoped.has(n));
  }
  return [...new Set(names)];
}

/**
 * Is `name` listed in the approved-technologies document?
 *
 * A WHOLE-TOKEN match, case-insensitively: the list is a prose document with tables and backticks, so a
 * substring test would approve `express` because the list mentions `express-session`, and an exact line match
 * would reject every entry written as `mocha · chai`. The boundary class holds the characters a package name is
 * made of, which is what makes `express` ≠ `express-session` and `github.com/a/b` ≠ `github.com/a/bc`.
 */
export function listedIn(name: string, doc: string): boolean {
  const b = "[A-Za-z0-9._@/+-]";
  return new RegExp(`(?<!${b})${escapeRe(name)}(?!${b})`, "i").test(doc);
}

/**
 * Evaluate every file-triggered check against the changeset.
 *
 * WHAT EACH PREDICATE MEANS OVER A DIFF — decided, not assumed, and this is the table to read before writing a
 * clause:
 *
 *   list-membership      every dependency name ADDED to a matching manifest appears in the `list=` document.
 *                        Four formats (npm · go.mod · pom.xml · requirements.txt); a name that cannot be parsed
 *                        is NOT a violation (see `addedDependencies`).
 *   content-forbidden    `pattern=` must not appear in any line the change ADDED to a matching file. NOT in the
 *                        whole file: a pre-existing match is somebody else's problem, and blocking on it blocks
 *                        unrelated work until the check is switched off.
 *   content-required     every matching file must CONTAIN `pattern=` in its whole text, optionally only within
 *                        the first `within_lines=` lines. Whole text, because "the file carries an SPDX header"
 *                        is true or false of the file, not of the hunk — a one-line fix to a compliant file
 *                        must not fail for not re-adding the header.
 *   file-required        a change matching `when=` requires a change ALSO matching `require=`, in the SAME
 *                        changeset — "a behaviour change brings a test".
 *   frontmatter-required every matching file carries every key in `keys=` in its `---` front matter.
 *   naming               every matching path must satisfy `pattern=`; with `subject=branch`, the branch does.
 *   path-scope           no changed path may fall outside `writable=`.
 *
 * DELETIONS. A deletion has no added lines and no text, so the four predicates that look INSIDE a file
 * (list-membership · content-forbidden · content-required · frontmatter-required) SKIP it. The alternative is
 * absurd in a specific way: a file that fails the SPDX check could never be deleted, because deleting it reports
 * the file as lacking the header it no longer needs. `naming` skips deletions too — refusing a deletion because
 * the old path broke a convention traps the badly named file in the repository forever. `path-scope` and
 * `file-required` DO count deletions: removing a file is a write, and a deletion under `src/**` is a behaviour
 * change like any other.
 *
 * A DOCUMENT OR TEXT THAT COULD NOT BE READ is a loud WARNING, never a quiet pass. Both cases mean the check
 * evaluated nothing, and the message says exactly that — the same reasoning that makes an unknown check kind a
 * diagnostic rather than silence.
 */
export function runDiffChecks(
  checks: readonly AttachedCheck[],
  changed: readonly ChangedFile[],
  read: ReadDoc,
  context: DiffContext = {},
): GateResult {
  const failures: GateFinding[] = [];
  const warnings: GateFinding[] = [];

  for (const { pol, doc, section, check } of checks) {
    const where = `${pol} (${doc} §${section})`;
    const push = (message: string): void => {
      const finding: GateFinding = { pol, doc, section, severity: check.onMiss, message };
      (check.onMiss === "fail" ? failures : warnings).push(finding);
    };
    /** An authoring problem, or a check that could not run: always said out loud, never fatal to the run. */
    const note = (message: string): void => { warnings.push({ pol, doc, section, severity: "warn", message }); };
    const globs = check.trigger.on === "files" ? check.trigger.globs : [];

    switch (check.kind) {
      case "list-membership": {
        const listPath = attr(check, "list");
        if (!listPath) { note(`${where}: list-membership has no list= — there is no list to check against.`); break; }
        const listText = read(listPath);
        if (listText === null) {
          // Loud, because this is the shape of a check that reads as enforced and is not: the clause is right,
          // the trigger fires, and the document it judges against is not there.
          note(`${where}: \`${listPath}\` could not be read from the ratified branch, so this check approved every dependency in the change. Fix the list= path, or add the document.`);
          break;
        }
        for (const file of liveMatches(changed, globs)) {
          for (const name of addedDependencies(file)) {
            if (!listedIn(name, listText)) {
              push(`${where}: \`${file.path}\` adds \`${name}\`, which is not in \`${listPath}\`. Add it there in its own pull request (an approval is a pull request to that file), or use something already approved.`);
            }
          }
        }
        break;
      }

      case "content-forbidden": {
        const pattern = attr(check, "pattern");
        if (!pattern) { note(`${where}: content-forbidden has no pattern= — it forbids nothing.`); break; }
        const compiled = compile(pattern, "");
        if ("error" in compiled) { note(`${where}: pattern=${pattern} is not a valid regular expression (${compiled.error}), so nothing was checked.`); break; }
        for (const file of liveMatches(changed, globs)) {
          const hits = file.addedLines.filter((l) => compiled.re.test(l)).length;
          if (hits) {
            // THE MATCHED LINE IS NOT PRINTED. This predicate's first use is "no credential in a file", and
            // echoing the match would copy the secret into the CI log, the pull request and every notification
            // built on them — spreading exactly what the clause forbids. The file and the count are actionable.
            push(`${where}: \`${file.path}\` adds ${hits} line(s) matching \`${pattern}\`, which this clause forbids. Remove them from the change (the line is not printed here on purpose — it may be the secret itself).`);
          }
        }
        break;
      }

      case "content-required": {
        const pattern = attr(check, "pattern");
        if (!pattern) { note(`${where}: content-required has no pattern= — it requires nothing.`); break; }
        const compiled = compile(pattern, "m");
        if ("error" in compiled) { note(`${where}: pattern=${pattern} is not a valid regular expression (${compiled.error}), so nothing was checked.`); break; }
        const withinLines = Number(attr(check, "within_lines")) || 0;
        for (const file of liveMatches(changed, globs)) {
          if (file.text === null) { note(`${where}: \`${file.path}\` could not be read, so it was not checked for ${pattern}.`); continue; }
          const scope = withinLines > 0 ? file.text.split(/\r?\n/).slice(0, withinLines).join("\n") : file.text;
          if (!compiled.re.test(scope)) {
            const limit = withinLines > 0 ? ` within its first ${withinLines} line(s)` : "";
            push(`${where}: \`${file.path}\` does not contain \`${pattern}\`${limit} — add it to the file.`);
          }
        }
        break;
      }

      case "file-required": {
        const required = list(check, "require");
        if (!required.length) { note(`${where}: file-required has no require= — it asks for nothing.`); break; }
        const paths = changed.map((c) => c.path);
        const trigger = filterByGlobs(paths, globs);
        if (!trigger.length) break;
        if (!filterByGlobs(paths, required).length) {
          push(`${where}: this change touches \`${trigger[0]}\` but nothing in it matches ${required.map((r) => `\`${r}\``).join(" or ")}. Add the change the clause asks for (a test that fails without this one) in the same pull request.`);
        }
        break;
      }

      case "frontmatter-required": {
        const keys = list(check, "keys");
        if (!keys.length) { note(`${where}: frontmatter-required has no keys= — it requires nothing.`); break; }
        // `paths=` is the verb gate's spelling of "which files". Honoured here as a FURTHER narrowing of the
        // trigger, never as a replacement: a check that fired on `when=` and then judged a different set would
        // report findings about files the pull request never touched.
        const narrow = list(check, "paths");
        for (const file of liveMatches(changed, globs)) {
          if (narrow.length && !matchesAny(file.path, narrow)) continue;
          if (file.text === null) { note(`${where}: \`${file.path}\` could not be read, so its front matter was not checked.`); continue; }
          const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(file.text)?.[1] ?? "";
          const missing = keys.filter((k) => !new RegExp(`^${escapeRe(k)}:`, "m").test(fm));
          if (missing.length) {
            push(`${where}: \`${file.path}\` is missing front matter ${missing.join(", ")} — add the key(s) to the \`---\` block at the top.`);
          }
        }
        break;
      }

      case "naming": {
        const pattern = attr(check, "pattern");
        if (!pattern) { note(`${where}: naming has no pattern= — there is nothing to match.`); break; }
        const compiled = compile(pattern, "");
        if ("error" in compiled) { note(`${where}: pattern=${pattern} is not a valid regular expression (${compiled.error}), so nothing was checked.`); break; }
        const subject = attr(check, "subject");
        if (subject === "branch") {
          if (context.branch === undefined) { note(`${where}: naming subject=branch, but the branch is not known here.`); break; }
          if (!compiled.re.test(context.branch)) push(`${where}: branch \`${context.branch}\` does not match ${pattern} — rename the branch.`);
          break;
        }
        if (subject && subject !== "path") { note(`${where}: naming subject=${subject} is not known over a changeset (\`path\` or \`branch\`).`); break; }
        for (const file of changed) {
          if (file.status === "deleted" || !matchesAny(file.path, globs)) continue;
          if (!compiled.re.test(file.path)) push(`${where}: \`${file.path}\` does not match ${pattern} — rename it.`);
        }
        break;
      }

      case "path-scope": {
        const writable = list(check, "writable");
        if (!writable.length) { note(`${where}: path-scope has no writable= — it permits nothing, so it would fail every change. Give the scope.`); break; }
        const outside = changed.map((c) => c.path).filter((p) => !matchesAny(p, writable));
        if (outside.length) {
          push(`${where}: ${outside.length} changed path(s) outside the permitted scope (${writable.map((w) => `\`${w}\``).join(", ")}), e.g. \`${outside[0]}\`. Move the change, or have the scope widened in policy.`);
        }
        break;
      }

      default:
        // Unreachable while `CHECK_KINDS` has seven members — and here anyway, because the next kind added to
        // checks/predicates.ts would otherwise be bound, counted as CHECKED, and evaluated by nothing. That
        // is the exact defect this module was written to fix; it must not be reintroduced silently.
        note(`${where}: \`${(check as Check).kind}\` has no evaluator over a changeset, so this clause checked nothing.`);
    }
  }

  return { ok: failures.length === 0, failures, warnings };
}

/** The report, as a person reads it in `gov validate`: what failed, why, and the clause that asked. */
export function formatDiffChecks(result: GateResult): string[] {
  const out: string[] = [];
  for (const f of result.failures) out.push(`  ✗ ${f.message}`);
  for (const w of result.warnings) out.push(`  ! ${w.message}`);
  return out;
}

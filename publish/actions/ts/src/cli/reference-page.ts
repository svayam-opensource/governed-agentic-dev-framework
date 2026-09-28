// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * THE COMMAND REFERENCE, GENERATED FROM THE SPECS — the fourth surface of help-spec.ts.
 *
 * WHY THIS EXISTS. `publish/content/framework/docs/specs/gov-command-reference.md` was hand-written, and it
 * drifted the way hand-written references always do: it documented `gov-work` as the binary name, listed a
 * subcommand set of 21 verbs when gov dispatched 27, described `seed`'s prompts in an order the code no longer
 * asks in, and carried not one exit code — the field an AGENT branches on. That is the same failure the specs
 * were introduced to end (three hand-kept tables no parser read), one file further out.
 *
 * So the page is rendered, and a freshness test (`test/cli/reference-page.test.ts`, `npm run docs:cli:check`)
 * asserts the committed file equals what the specs produce now. Editing a spec without regenerating fails.
 *
 * BYTE-STABLE, OR THE FRESHNESS CHECK MEANS NOTHING. No timestamp, no version, no "generated on", nothing read
 * from the environment, no sort whose order depends on a locale — the only inputs are `specs` and `topics`, and
 * they are walked in the order they are given. A generator that embeds the clock produces a diff on every run,
 * which trains everyone to regenerate without reading, which is how the drift comes back.
 *
 * PURE. Text in, one string out. Finding the file, reading it and writing it is `scripts/gen-cli-reference.mjs`.
 */
import { GROUPS, mergedExit, type Topic } from "./help-render.js";
import type { CommandSpec } from "./help-spec.js";

/**
 * Where the rendered page belongs, relative to this package root (`publish/actions/ts`), first match wins.
 *
 * Two candidates because the docs tree has been reorganised once already and the generator must not invent a
 * second copy of the reference when it moves again: it writes over the file that is THERE. Declared here rather
 * than in the script so the freshness test resolves the same path by the same rule — a test that looks in the
 * other place passes while the committed file rots.
 */
export const REFERENCE_DOC_CANDIDATES: readonly string[] = [
  "../../content/framework/docs/gov-command-reference.md",
  "../../content/framework/docs/specs/gov-command-reference.md",
];

/**
 * The front matter the Knowledge Organization Standard requires of a shipped framework doc (POL-416): domain,
 * layer agreeing with the folder, owner, compliance, status. Part of the rendered output on purpose — if the
 * generator wrote only the body, regenerating would strip it and `gov validate` would fail on content we ship.
 */
const FRONT_MATTER = [
  "---",
  "domain: governance",
  "layer: spec",
  "owner: policy-owner",
  "compliance: C02",
  "status: current",
  "---",
];

/** The file to edit instead of this one. Named in the page, because "do not edit" without a where is a taunt. */
const SOURCE_FILE = "publish/actions/ts/src/cli/help-spec.ts";

/**
 * A GitHub heading anchor: lower case, punctuation dropped, spaces to hyphens.
 *
 * Every cross-reference in this page is computed with this one function, from the same heading text that was
 * rendered — so an anchor cannot be stale. `seeAlso` links are checked against the commands actually rendered
 * (see `linkTo`), which is the other half of making a broken internal link impossible rather than unlikely.
 */
export const anchorOf = (heading: string): string =>
  heading.toLowerCase().replace(/[^a-z0-9 _-]/g, "").trim().replace(/ +/g, "-");

/**
 * Prose, safe for markdown. `<project-id>`, `<n>`, `<slug>` are all over the specs, and a bare `<project-id>`
 * is parsed as an HTML tag: GitHub renders the sentence with the argument silently MISSING, which is worse than
 * a broken link because it still reads like a sentence. Code spans are left exactly as written — escaping
 * inside them would print `&lt;` to the reader.
 */
export function prose(text: string): string {
  return text
    .split(/(`[^`]*`)/)
    .map((part, i) => (i % 2 === 1 ? part : part.replace(/</g, "&lt;").replace(/>/g, "&gt;")))
    .join("");
}

/** A table cell: prose, plus the pipe that would otherwise end the cell early. */
const cell = (text: string): string => prose(text).replace(/\|/g, "\\|");

/** `**Label.** text` — the one-line fields (WHERE, CHANGES), which are sentences and not tables. */
const field = (label: string, text: string): string[] => ["", `**${label}.** ${prose(text)}`];

const fence = (lang: string, lines: readonly string[]): string[] => ["", "```" + lang, ...lines, "```"];

const table = (head: readonly [string, string], rows: readonly (readonly [string, string])[]): string[] => [
  "",
  `| ${head[0]} | ${head[1]} |`,
  "| --- | --- |",
  ...rows.map((r) => `| ${r[0]} | ${r[1]} |`),
];

const heading = (spec: CommandSpec): string => `gov ${spec.name}`;

/**
 * Group the specs the way the terminal overview does, and — the point of the fallback — never drop one.
 *
 * A fourth audience added to help-spec.ts would match no group and its commands would vanish from the
 * reference while every other check stayed green. So anything ungrouped gets its own section, named after the
 * audience: visibly unfinished beats invisibly absent.
 */
function grouped(specs: readonly CommandSpec[]): { readonly title: string; readonly specs: CommandSpec[] }[] {
  const out = GROUPS.map((g) => ({ title: g.title, specs: specs.filter((s) => s.audience === g.audience) }));
  const known = new Set(GROUPS.map((g) => g.audience as string));
  for (const s of specs) {
    if (known.has(s.audience)) continue;
    const section = out.find((o) => o.title === s.audience) ?? { title: s.audience, specs: [] };
    if (!out.includes(section)) out.push(section);
    section.specs.push(s);
  }
  return out.filter((g) => g.specs.length > 0);
}

/**
 * The topic lines as markdown. A topic is prose with runs of two-space-indented lines that are really a table
 * (`the branch  BRNCH-<board#>-<slug>`); markdown collapses that alignment into one run-on line, so each run
 * becomes a fenced block and the prose around it stays prose.
 */
function topicBody(lines: readonly string[]): string[] {
  const out: string[] = [];
  let block: string[] = [];
  const flush = (): void => {
    if (block.length) out.push(...fence("text", block.map((l) => l.replace(/^ {2}/, ""))));
    block = [];
  };
  for (const l of lines) {
    if (l.startsWith("  ")) { block.push(l); continue; }
    flush();
    out.push(l ? prose(l) : "");
  }
  flush();
  return out;
}

/**
 * ONE COMMAND, in the order the terminal page uses — a reader who knows `gov help task` finds the same fields
 * in the same sequence here. CHANGES and EXIT are the two a hand-written reference always omits (the old one
 * had neither for any command), which is precisely why they are generated.
 */
function commandSection(spec: CommandSpec, links: ReadonlySet<string>): string[] {
  const out = ["", `### ${heading(spec)}`, "", prose(spec.summary)];
  out.push(...fence("text", [`gov ${spec.name}${spec.usage ? ` ${spec.usage}` : ""}`]));
  if (spec.where) out.push(...field("Where", spec.where));
  if (spec.args?.length) {
    out.push("", "**Arguments**");
    out.push(...table(["argument", "what it is"], spec.args.map((a) => [`\`${a.name}\``, cell(a.what)] as const)));
  }
  if (spec.flags?.length) {
    out.push("", "**Flags**");
    out.push(...table(["flag", "what it does"], spec.flags.map((f) => [`\`${f.name}\``, cell(f.what)] as const)));
  }
  out.push("", "**Examples**", ...fence("bash", spec.examples));
  if (spec.changes) out.push(...field("Changes", spec.changes));
  if (spec.exit?.length) {
    out.push("", "**Exit codes**");
    out.push(...table(["code", "means"], mergedExit(spec.exit).map((e) => [`\`${e.code}\``, cell(e.means)] as const)));
  }
  if (spec.seeAlso?.length) {
    out.push("", `**See also.** ${spec.seeAlso.map((n) => linkTo(n, links)).join(" · ")}`);
  }
  return out;
}

/**
 * A link to another command's section — or, when that command is not on this page, plain code.
 *
 * `seeAlso` is a hand-written list of names, so a rename or a removal can point at nothing. A generated doc
 * that ships a link to `#gov-deps` after `deps` is dropped is a defect the generator can rule out entirely:
 * no target, no link. The reader still learns the name.
 */
const linkTo = (name: string, links: ReadonlySet<string>): string =>
  links.has(name) ? `[gov ${name}](#${anchorOf(`gov ${name}`)})` : `\`gov ${name}\``;

/** THE WHOLE PAGE. Same specs in, same bytes out, always. */
export function renderReference(specs: readonly CommandSpec[], topics: readonly Topic[]): string {
  const groups = grouped(specs);
  const links = new Set(specs.map((s) => s.name));
  const out: string[] = [
    ...FRONT_MATTER,
    "# gov command reference",
    "",
    "<!-- GENERATED FILE — do not edit. -->",
    "",
    "> **Generated — do not edit this file.** Every line below is rendered from the command specs in",
    `> \`${SOURCE_FILE}\`, the same source \`gov help\` reads. Change a command there and run`,
    "> `npm run docs:cli`. `npm run docs:cli:check` and `test/cli/reference-page.test.ts` both fail while this",
    "> file and the specs disagree, so an edit made here is lost rather than kept.",
    "",
    "Every verb, what it does, what it changes, and who normally runs it. A reference — consulted, not read",
    "through. The same pages are in the terminal: `gov help <command>`, `gov help <topic>`, `gov help --json`.",
    "",
    "## Contents",
  ];

  for (const g of groups) {
    out.push("", `**[${g.title}](#${anchorOf(g.title)})**`, "");
    for (const s of g.specs) out.push(`- [${heading(s)}](#${anchorOf(heading(s))}) — ${prose(s.summary)}`);
  }
  if (topics.length) {
    out.push("", "**[Concepts](#concepts)**", "");
    for (const t of topics) out.push(`- [${t.title}](#${anchorOf(t.title)}) — \`gov help ${t.name}\``);
  }

  for (const g of groups) {
    out.push("", "---", "", `## ${g.title}`);
    for (const s of g.specs) out.push(...commandSection(s, links));
  }

  if (topics.length) {
    out.push(
      "", "---", "", "## Concepts", "",
      "The ideas the commands assume. Short on purpose: a concept that needs a page of prose is a sign the",
      "commands are wrong, not that the concept is deep.",
    );
    for (const t of topics) out.push("", `### ${t.title}`, "", ...topicBody(t.lines));
  }

  // One trailing newline, never two: a file that ends differently from what the generator writes is a diff the
  // freshness check reports and nobody can see.
  return `${out.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd()}\n`;
}

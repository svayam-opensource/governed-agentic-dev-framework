// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * THE GENERATED COMMAND REFERENCE — coverage, stability, and the freshness assertion.
 *
 * The hand-written `gov-command-reference.md` drifted exactly as far as a hand-written reference always does:
 * 21 verbs listed of 27 dispatched, `gov-work` named as the binary, and no exit codes at all. These tests are
 * therefore about the same two things the help tests are about — COVERAGE (a command cannot be forgotten) and
 * DRIFT (the committed file cannot disagree with the specs) — plus the two properties that only matter because
 * the file is generated: byte-stability, and internal links that resolve.
 */
import { expect } from "chai";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { COMMAND_SPECS } from "../../src/cli/help-spec.js";
import { GROUPS, TOPICS } from "../../src/cli/help-render.js";
import { anchorOf, prose, REFERENCE_DOC_CANDIDATES, renderReference } from "../../src/cli/reference-page.js";

const pkgRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

/** The same rule the generator uses: the candidate that EXISTS, else the canonical last one. */
function referencePath(): string {
  const abs = REFERENCE_DOC_CANDIDATES.map((p) => path.join(pkgRoot, p));
  return abs.find((p) => fs.existsSync(p)) ?? abs[abs.length - 1]!;
}

const page = renderReference(COMMAND_SPECS, TOPICS);

/** Every anchor a reader can land on: GitHub derives them from the headings, so the headings are the source. */
const anchors = new Set(
  page.split("\n").filter((l) => /^#{1,6}\s/.test(l)).map((l) => anchorOf(l.replace(/^#{1,6}\s+/, ""))),
);

describe("cli reference — every command is on the page", () => {
  // THE DRIFT GUARD, the same one help.test.ts applies to the terminal pages. A command with a spec but no
  // section is a command the published reference does not mention, which is how the old file came to list 21.
  it("every command in COMMAND_SPECS has a section, including the maintainer ones", () => {
    const missing = COMMAND_SPECS.filter((s) => !page.includes(`\n### gov ${s.name}\n`)).map((s) => s.name);
    expect(missing, "commands with no section in the reference").to.deep.equal([]);
  });

  it("and a table-of-contents entry linking to it", () => {
    const missing = COMMAND_SPECS
      .filter((s) => !page.includes(`- [gov ${s.name}](#${anchorOf(`gov ${s.name}`)}) —`))
      .map((s) => s.name);
    expect(missing, "commands missing from the contents").to.deep.equal([]);
  });

  // The reference documents `deps` and `publish`; `gov help` hides them. Deliberate and opposite: the overview
  // teaches where to start, a reference answers "what is this thing I just typed".
  it("unlike the terminal overview, it does not hide the maintainer commands", () => {
    expect(page).to.contain("## Building gov itself").and.contain("### gov publish").and.contain("### gov deps");
  });

  it("groups them under the titles help-render already owns", () => {
    for (const g of GROUPS) expect(page, `${g.title} is a section`).to.contain(`\n## ${g.title}\n`);
  });

  it("and carries the concept topics as their own section", () => {
    expect(page).to.contain("\n## Concepts\n");
    for (const t of TOPICS) expect(page, `${t.name} is documented`).to.contain(`\n### ${t.title}\n`);
  });
});

describe("cli reference — the same specs produce the same bytes", () => {
  // WITHOUT THIS THE FRESHNESS CHECK IS THEATRE. A generator that embeds a timestamp or a version fails its own
  // check on every run, which teaches everyone to regenerate without reading the diff — the drift, restored.
  it("rendering twice is byte-identical", () => {
    expect(renderReference(COMMAND_SPECS, TOPICS)).to.equal(page);
  });

  // A version number CAN appear — `gov bump-version 1.3.0` is an example in a spec — so this checks the two
  // things a generator adds of its own accord: a date, and the package's own version.
  it("carries no date and no build stamp of its own", () => {
    expect(page, "a generated-on line makes every run a diff").to.not.match(/\b20\d\d-\d\d-\d\d\b/);
    expect(page.toLowerCase()).to.not.contain("generated on").and.not.contain("generated at");
  });

  it("ends in exactly one newline, so no editor's save is a diff", () => {
    expect(page.endsWith("\n")).to.equal(true);
    expect(page.endsWith("\n\n")).to.equal(false);
  });
});

describe("cli reference — the fields a hand-written doc always omits", () => {
  // CHANGES and EXIT are why this page is generated at all: the hand-written predecessor had neither, and an
  // agent branches on the exit code. Asserted from the spec text, so a reworded spec must reach the page.
  it("every spec's CHANGES text reaches the page", () => {
    const missing = COMMAND_SPECS
      .filter((s) => s.changes && !page.includes(prose(s.changes).slice(0, 48)))
      .map((s) => s.name);
    expect(missing, "commands whose CHANGES text is not in the reference").to.deep.equal([]);
  });

  it("every spec's EXIT meanings reach the page", () => {
    const missing = COMMAND_SPECS
      .flatMap((s) => (s.exit ?? []).map((e) => ({ name: s.name, means: e.means })))
      .filter((e) => !page.includes(prose(e.means)))
      .map((e) => `${e.name}: ${e.means}`);
    expect(missing, "exit meanings not in the reference").to.deep.equal([]);
  });

  // `<project-branch>` unescaped is an HTML tag: GitHub drops it and the sentence still reads like a sentence,
  // which is how a reference comes to describe a branch name that has no name in it.
  it("escapes the angle-bracketed tokens the specs are full of", () => {
    expect(page, "seed scaffolds projects/<id>/").to.contain("projects/&lt;id&gt;/");
    expect(page, "and inside a code span they stay literal").to.contain("gov task <issue-url>");
  });

  it("names the file to edit instead of this one", () => {
    expect(page).to.contain("src/cli/help-spec.ts").and.contain("npm run docs:cli");
    expect(page.split("\n").slice(0, 20).join("\n"), "and says so before anything else").to.match(/GENERATED/);
  });
});

describe("cli reference — no link points at nothing", () => {
  // A broken cross-reference in a GENERATED doc is a defect the generator should make impossible, not one a
  // reviewer should catch: `seeAlso` is a hand-written list of names, so a rename can point at a section that
  // no longer exists. The renderer degrades an unresolvable name to plain code instead of emitting the link.
  it("every internal link resolves to a heading on the page", () => {
    const targets = [...page.matchAll(/\]\(#([^)]+)\)/g)].map((m) => m[1]!);
    expect(targets.length, "there are cross-references to check").to.be.greaterThan(COMMAND_SPECS.length);
    const dangling = [...new Set(targets)].filter((t) => !anchors.has(t));
    expect(dangling, "link targets with no matching heading").to.deep.equal([]);
  });

  it("seeAlso becomes a link to the other command's section", () => {
    const withSeeAlso = COMMAND_SPECS.filter((s) => s.seeAlso?.length);
    expect(withSeeAlso.length).to.be.greaterThan(20);
    for (const s of withSeeAlso) {
      for (const other of s.seeAlso!) {
        const expected = COMMAND_SPECS.some((c) => c.name === other)
          ? `[gov ${other}](#${anchorOf(`gov ${other}`)})`
          : `\`gov ${other}\``;
        expect(page, `${s.name} → ${other}`).to.contain(expected);
      }
    }
  });

  it("an unresolvable seeAlso is printed, never linked", () => {
    const orphan = renderReference(
      [{ ...COMMAND_SPECS[0]!, seeAlso: ["a-command-that-was-deleted"] }],
      [],
    );
    expect(orphan).to.contain("`gov a-command-that-was-deleted`");
    expect(orphan).to.not.contain("#gov-a-command-that-was-deleted");
  });
});

describe("cli reference — the committed file is the generated one (freshness)", () => {
  /**
   * THE ASSERTION THAT MAKES `docs:cli:check` REDUNDANT IN CI. It fails the moment a spec is edited without
   * `npm run docs:cli`, and the moment the published markdown is edited by hand — which is the only failure
   * mode a generated file has, and the one nobody notices by reading.
   */
  it("publish/content/.../gov-command-reference.md equals renderReference(COMMAND_SPECS, TOPICS)", () => {
    const file = referencePath();
    expect(fs.existsSync(file), `${file} has never been generated — run: npm run docs:cli`).to.equal(true);
    const onDisk = fs.readFileSync(file, "utf8");
    if (onDisk !== page) {
      const a = onDisk.split("\n");
      const b = page.split("\n");
      let i = 0;
      while (i < a.length && i < b.length && a[i] === b[i]) i++;
      expect.fail(
        `${path.basename(file)} is stale — run: npm run docs:cli\n`
        + `  first difference at line ${i + 1}\n`
        + `  on disk: ${a[i] ?? "(end of file)"}\n`
        + `  specs:   ${b[i] ?? "(end of file)"}`,
      );
    }
  });

  it("and still carries the front matter the knowledge validator requires", () => {
    expect(page.startsWith("---\n"), "front matter must survive regeneration").to.equal(true);
    for (const key of ["domain:", "layer: spec", "owner:", "compliance:", "status: current"]) {
      expect(page.slice(0, 200), key).to.contain(key);
    }
  });
});

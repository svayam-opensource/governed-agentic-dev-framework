// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
//
// THE SHIPPED FRAMEWORK RULE STORE, READ THE WAY AN ADOPTER'S gov WILL READ IT (W2, rule-model-design.md Q3–Q10,
// W2-Q1…Q10).
//
// `framework/rules/rules.yaml` is written by hand for this release and by `gov upgrade` after it. Either way its
// rows point at prose in `framework-specification.md` by section and sha, and nothing else keeps the two in step:
// edit a section and forget its rows, and every row still loads, cites a section that exists, and describes text
// nobody wrote. So this test re-hashes each cited section and fails on a stale sha — the same guard Q9 asks of an
// org row — and loads the store through the real reader, so a row the reader would flag fails here first.
import { expect } from "chai";
import { readFileSync } from "node:fs";
import * as path from "node:path";
import { loadRuleStores, RULE_STORE_PATHS } from "../../src/rules/model/store-io.js";
import { inForce, parseRuleStore } from "../../src/rules/model/rule-row.js";
import { clauseSha } from "../../src/rules/cue-block.js";
import type { GitRead } from "../../src/cli/policy-gate-io.js";

const CONTENT = path.join(import.meta.dirname, "..", "..", "..", "..", "content");
const SPEC_DOC = "framework/docs/specs/framework-specification.md";
const read = (rel: string): string => readFileSync(path.join(CONTENT, rel), "utf8");

/**
 * The text of one numbered section (`### 6.2 …` or `## 6. …`): its heading line up to the next heading at its own
 * level or above. Fence-aware, so a `#` inside a code block is not a heading.
 */
export function sectionText(markdown: string, section: string): string | null {
  const lines = markdown.split("\n");
  let start = -1, depth = 0, inFence = false;
  const out: string[] = [];
  for (const line of lines) {
    if (/^```/.test(line)) inFence = !inFence;
    const h = inFence ? null : /^(#{2,6})\s+(\d+(?:\.\d+)*)\.?\s/.exec(line);
    const any = inFence ? null : /^(#{1,6})\s/.exec(line);
    if (start >= 0 && any && any[1].length <= depth) break;
    if (start < 0 && h && h[2] === section) { start = 1; depth = h[1].length; }
    if (start >= 0) out.push(line);
  }
  return start >= 0 ? out.join("\n").trim() : null;
}

/** The repository at one ref, as `git ls-tree` / `git show` see it. */
function gitOver(files: Record<string, string>): GitRead {
  return (_repo, args) => {
    if (args[0] === "ls-tree") {
      const roots = args.slice(args.indexOf("--") + 1);
      return Object.keys(files).filter((p) => roots.some((r) => p === r || p.startsWith(`${r}/`))).join("\n");
    }
    if (args[0] === "show") return files[args[1].slice(args[1].indexOf(":") + 1)] ?? null;
    return null;
  };
}

describe("framework rules — the shipped store", () => {
  const text = read(RULE_STORE_PATHS.frameworkRules);
  const rows = parseRuleStore(text);
  const spec = read(SPEC_DOC);

  it("loads through the real reader with zero diagnostics", () => {
    const r = loadRuleStores(gitOver({
      [RULE_STORE_PATHS.frameworkRules]: text,
      [RULE_STORE_PATHS.frameworkCatalog]: read(RULE_STORE_PATHS.frameworkCatalog),
      [RULE_STORE_PATHS.orgConfig]: 'org_slug: "SVM"\n',
    }), "/repo", "main");
    expect(r.ok, r.ok ? "" : r.reason).to.equal(true);
    if (!r.ok) return;
    expect(r.diagnostics.map((d) => `${d.id} ${d.kind}: ${d.message}`)).to.deep.equal([]);
    expect(r.set.framework.length).to.be.greaterThan(40);
  });

  it("every row cites a section of framework-specification.md, at the sha of its current text", () => {
    const stale = rows.flatMap((r) => {
      if (r.source.doc !== SPEC_DOC) return [`${r.id}: source is ${r.source.doc}`];
      const s = sectionText(spec, r.source.section);
      if (s === null) return [`${r.id}: no section ${r.source.section}`];
      const sha = clauseSha(s);
      return sha === r.source.sha ? [] : [`${r.id}: §${r.source.section} is ${sha}, row says ${r.source.sha}`];
    });
    expect(stale).to.deep.equal([]);
  });

  it("every gov-client promise is checked by a tagged test (Q3/Q4)", () => {
    const unchecked = inForce(rows)
      .filter((r) => r.actor.length === 1 && r.actor[0] === "gov-client")
      .filter((r) => !(r.checks ?? []).some((c) => c.action === "gov-builtin/test-suite" && c.on.resource === "vcs.framework-repo"))
      .map((r) => r.id);
    expect(unchecked).to.deep.equal([]);
  });

  it("expectations name their actor — no pronoun subjects (Q9)", () => {
    expect(rows.filter((r) => /^(It|They|This)\b/.test(r.expectation)).map((r) => r.id)).to.deep.equal([]);
  });

  it("ids are unique within the shipped release (one row per rule)", () => {
    const ids = rows.map((r) => r.id);
    expect(ids.filter((id, i) => ids.indexOf(id) !== i)).to.deep.equal([]);
  });

  it("the specification's prose carries no GOV ids, levels-as-ids or POL numbers (ids live in rows)", () => {
    expect(spec.match(/\b(GOV|POL)-[A-Z0-9]+-?\d*/g) ?? []).to.deep.equal([]);
  });
});

describe("sectionText", () => {
  const md = "## 1. One\n\n### 1.1 A\n\na\n\n```\n# not a heading\n```\n\n### 1.2 B\n\nb\n\n## 2. Two\n";
  it("cuts a subsection at the next heading of its level, ignoring fenced lines", () => {
    expect(sectionText(md, "1.1")).to.equal("### 1.1 A\n\na\n\n```\n# not a heading\n```");
  });
  it("a chapter runs to the next chapter", () => {
    expect(sectionText(md, "1")?.endsWith("b")).to.equal(true);
  });
  it("an absent section is null", () => {
    expect(sectionText(md, "9.9")).to.equal(null);
  });
});

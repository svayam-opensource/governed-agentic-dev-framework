// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * THE SHIPPED POLICIES' POL NUMBERS, CHECKED AGAINST THE LOCK — the guard that was missing when it was needed.
 *
 * The lock module was designed, tested and committed, and then the framework's policy was rewritten **by hand**
 * without it. Four defects came through in one afternoon, and none of them would fail a build:
 *
 *   · POL-121 changed MEANING — "update project knowledge" became "an agent must not write to knowledge/", so
 *     every existing citation of POL-121 still resolved and now said something else.
 *   · POL-114 and POL-116 each appeared twice as clause markers, because a step that CITES a clause was written
 *     as though it declared one.
 *   · eight numbers vanished with no record of whether they were retired or dropped by accident.
 *   · POL-120 was deleted outright.
 *
 * A pure unit test of `allocate()` cannot catch any of that: the defect is in the CONTENT, and the content was
 * never put through the module. So this test reads the shipped policies themselves. It is the reason the next
 * hand-edit fails in CI instead of in an audit.
 */
import { expect } from "chai";
import { readFileSync, globSync, existsSync } from "node:fs";
import * as path from "node:path";
import { parseClauses } from "../../src/rules/notation.js";
import { clauseSha } from "../../src/rules/cue-block.js";

const CONTENT = path.join(import.meta.dirname, "..", "..", "..", "..", "content");
const LOCK = path.join(CONTENT, "framework", "policies", ".pol-lock.json");

/** A clause marker: `**(POL-042)**`, `**(C01, POL-086a)**`. NOT a prose citation like "§6.5, POL-114". */
const MARKER = /\*\*\(?(?:C0\d,\s*)?POL-(\d{3}[a-z]?)\)?\*\*/g;

interface Entry { pol: string; doc: string; section: string; clauseSha: string; retired?: boolean }

/** The lock, as gov reads it: JSON, so the test and the CLI cannot disagree about what an entry says. */
function readLock(): { start: number; entries: Entry[] } {
  const doc = JSON.parse(readFileSync(LOCK, "utf8")) as { start: number; entries: Entry[] };
  return { start: doc.start, entries: doc.entries };
}

/** Every clause marker in the framework's policies, with the clause it marks. */
function markers(): { pol: string; doc: string; section: string; sha: string }[] {
  const out: { pol: string; doc: string; section: string; sha: string }[] = [];
  for (const f of globSync(path.join(CONTENT, "framework", "policies", "*.md")).sort()) {
    const doc = path.relative(CONTENT, f).split(path.sep).join("/");
    const text = readFileSync(f, "utf8");
    const { clauses } = parseClauses(doc, text);
    for (const m of text.matchAll(MARKER)) {
      const line = text.slice(0, m.index).split("\n").length;
      const owner = [...clauses].filter((c) => c.line <= line).pop();
      if (owner) out.push({ pol: `POL-${m[1]}`, doc, section: owner.section, sha: clauseSha(owner.text) });
    }
  }
  return out;
}

describe("shipped policies — POL numbers are locked, unique, and never re-pointed", () => {
  it("the lock exists and reserves the framework's next number", () => {
    expect(existsSync(LOCK), `${LOCK} — a policy tree with no lock can renumber silently`).to.equal(true);
    const { start } = readLock();
    expect(start, "the framework allocates in 001–199; 001–173 are taken").to.be.greaterThan(173);
    expect(start, "200+ belongs to the organization's own clauses").to.be.lessThan(200);
  });

  it("NO clause marker is used twice — a number names exactly one rule", () => {
    const counts = new Map<string, string[]>();
    for (const m of markers()) counts.set(m.pol, [...(counts.get(m.pol) ?? []), `${m.doc} §${m.section}`]);
    const dupes = [...counts].filter(([, where]) => new Set(where).size > 1);
    expect(dupes.map(([pol, where]) => `${pol}: ${[...new Set(where)].join(" and ")}`), "cite a clause in prose (\"§6.5, POL-114\"); a **(POL-x)** marker DECLARES one").to.deep.equal([]);
  });

  it("every clause marker is in the lock — a clause gov cannot cite is a clause nobody can audit", () => {
    const locked = new Set(readLock().entries.map((e) => e.pol));
    const missing = [...new Set(markers().filter((m) => !locked.has(m.pol)).map((m) => `${m.pol} (${m.doc} §${m.section})`))];
    expect(missing, "run `gov rules build` — it allocates, or asks").to.deep.equal([]);
  });

  it("no locked number POINTS AT DIFFERENT TEXT than it was allocated for", () => {
    // The defect this exists for: a reworded clause keeping its number inherits an approval it never had, and
    // the old citation now resolves to a different rule. A rewording is allowed — it must be CONFIRMED, which
    // moves the old identity into `history` rather than overwriting it silently.
    const byPol = new Map(readLock().entries.filter((e) => !e.retired).map((e) => [e.pol, e]));
    const moved: string[] = [];
    for (const m of markers()) {
      const e = byPol.get(m.pol);
      if (e && (e.clauseSha !== m.sha || e.section !== m.section)) {
        moved.push(`${m.pol}: locked at §${e.section}/${e.clauseSha}, found at §${m.section}/${m.sha}`);
      }
    }
    expect(moved, "confirm the rewording (`gov rules build` will ask) — never edit the lock by hand").to.deep.equal([]);
  });

  it("a retired number keeps its entry and says why, so an old citation still resolves", () => {
    const retired = readLock().entries.filter((e) => e.retired);
    expect(retired.length, "four clauses were retired in the 2026-09-26 rewrite").to.be.greaterThan(0);
    for (const e of retired) {
      expect(e.pol).to.match(/^POL-\d{3}[a-z]?$/);
      expect((e as unknown as { why?: string }).why, `${e.pol} is retired with no reason recorded`).to.be.a("string").and.not.empty;
    }
  });

  it("every POL number in the lock is inside the framework's ranges, never the organization's", () => {
    const outside = readLock().entries
      .map((e) => ({ pol: e.pol, n: Number(/\d{3}/.exec(e.pol)![0]) }))
      .filter(({ n }) => !((n >= 1 && n <= 199) || (n >= 400 && n <= 999)))
      .map(({ pol }) => pol);
    expect(outside, "POL-200…399 is the organization's range — the framework must not allocate there").to.deep.equal([]);
  });
});

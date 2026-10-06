// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * EVERY SPEC RULE HAS A TEST, OR THE BUILD FAILS (rule-model-design.md Q3/Q4 and the P1 ruling on spec-rule checks).
 *
 * A spec rule is a promise gov makes that others rely on: an in-force `GOV-FRM-*` row whose actor includes
 * `gov-client` and which binds `gov-builtin/test-suite`. The ruling: such a promise is checked by a test TITLED with
 * its id (`it("GOV-FRM-NNN …")`), and a promise with no tagged test fails the framework's build.
 *
 * HOW THE TITLES ARE COLLECTED: STATICALLY. Every `it("…")` / `specify("…")` title is read out of
 * test/**\/*.test.ts as a string literal, without running anything. Running mocha inside mocha would re-enter this
 * file and double the suite's time to learn what is written in the source anyway. The cost, stated: a title built at
 * run time (`it(\`${x} …\`)`) is invisible here, so a promise test must carry its id LITERALLY. An `it.skip` /
 * `xit` counts as pending, which the test-suite action never reads as proof.
 *
 * HOW A TITLE IS MATCHED: through the real `gov-builtin/test-suite` action (rules/checks/builtin.ts), so this gate
 * and the check an organization sees in its rule map cannot disagree about what "titled with the id" means.
 *
 * Only `it` titles count — the test-suite action matches a test's own title, and a `describe` naming an id proves
 * nothing about the tests inside it.
 *
 * KNOWN_UNKEPT is the debt, written down: promises the code does NOT keep today, so no honest test can be titled
 * with them. Its membership is EXACT — a listed id that gains a test, or stops being a spec rule, fails until it is
 * removed. The list can only shrink.
 */
import { expect } from "chai";
import * as fs from "node:fs";
import * as path from "node:path";
import { parseRuleStore, inForce, type RuleRow } from "../../src/rules/model/rule-row.js";
import { RULE_STORE_PATHS } from "../../src/rules/model/store-io.js";
import { runBuiltin, type TestResult } from "../../src/rules/checks/builtin.js";

const TS_ROOT = path.join(import.meta.dirname, "..", "..");
const CONTENT = path.join(TS_ROOT, "..", "..", "content");
const TEST_DIR = path.join(TS_ROOT, "test");
const TEST_SUITE = "gov-builtin/test-suite";

/** Promises the code does not keep yet — one line each saying what is missing. P3 work items. */
const KNOWN_UNKEPT: Readonly<Record<string, string>> = {
  "GOV-FRM-444": "MANIFEST.yaml has no entry for framework/rules/, so gov upgrade never ships rules.yaml, catalog.yaml or pol-aliases.yaml.",
  "GOV-FRM-456": "the governance snapshot and session prompt read the default branch, but ensureRootProtocol mirrors agent/harness/ from the project-branch worktree.",
  "GOV-FRM-461": "gov work --agent=<id> launches the named agent without checking it against authorized_agents.",
  "GOV-FRM-464": "rules/exceptions.ts compiles in-force exceptions, but nothing calls it — no build places them in the resident rules.",
  "GOV-FRM-465": "parseException accepts any GOV id as the clause; nothing refuses an exception naming a GOV-FRM rule.",
};

// ── titles ──────────────────────────────────────────────────────────────────────────────────────────────────────

/** `it("…")`, `it.only('…')`, `specify(`…`)`, `it.skip(…)`, `xit(…)` — the title literal and whether it would run. */
const TITLE = /\b(x?it|specify)(\.only|\.skip)?\s*\(\s*(["'`])((?:\\[\s\S]|(?!\3)[^\\])*)\3/g;

export function titlesIn(source: string): TestResult[] {
  const out: TestResult[] = [];
  for (const m of source.matchAll(TITLE)) {
    const skipped = m[1] === "xit" || m[2] === ".skip";
    out.push({ title: m[4]!, state: skipped ? "pending" : "passed" } as TestResult);
  }
  return out;
}

function testFiles(dir: string): string[] {
  return fs.readdirSync(dir).flatMap((n) => {
    const p = path.join(dir, n);
    return fs.statSync(p).isDirectory() ? testFiles(p) : n.endsWith(".test.ts") ? [p] : [];
  });
}

// ── promises ────────────────────────────────────────────────────────────────────────────────────────────────────

const isPromise = (r: RuleRow): boolean =>
  r.id.startsWith("GOV-FRM-") && r.actor.includes("gov-client") && (r.checks ?? []).some((c) => c.action === TEST_SUITE);

/** `framework-specification.md §2.4 When a role falls vacant` — where the promise is written. */
function sectionName(row: RuleRow): string {
  const doc = path.join(CONTENT, row.source.doc);
  const text = fs.existsSync(doc) ? fs.readFileSync(doc, "utf8") : "";
  const esc = row.source.section.replace(/\./g, "\\.");
  const heading = new RegExp(`^#{2,6}\\s+${esc}\\.?\\s+(.+)$`, "m").exec(text)?.[1]?.trim();
  return `${path.basename(row.source.doc)} §${row.source.section}${heading ? ` ${heading}` : ""}`;
}

const covered = (id: string, tests: readonly TestResult[]): boolean =>
  runBuiltin({
    ruleId: id, action: TEST_SUITE, params: {}, readDefault: () => null,
    ctx: { resource: "vcs.framework-repo", event: "pull_request", payload: { tests } },
  }).verdict === "pass";

describe("spec rules — every gov-client promise has a test titled with its id", () => {
  const rows = parseRuleStore(fs.readFileSync(path.join(CONTENT, RULE_STORE_PATHS.frameworkRules), "utf8"));
  const promises = inForce(rows).filter(isPromise);
  const tests = testFiles(TEST_DIR).flatMap((f) => titlesIn(fs.readFileSync(f, "utf8")));

  it("reads the promises and the titles it judges — an empty side would pass everything", () => {
    expect(promises.length, "in-force gov-client rows binding gov-builtin/test-suite").to.be.greaterThan(0);
    expect(tests.length, "test titles collected from test/**/*.test.ts").to.be.greaterThan(1000);
  });

  it("collects titles the way the test-suite action reads them: literal, pending when skipped, never a describe", () => {
    const got = titlesIn([
      `describe("GOV-TST-001 a describe proves nothing", () => {`,
      `  it("GOV-TST-002 plain", () => {});`,
      `  it.only('GOV-TST-003 single', () => {});`,
      "  specify(`GOV-TST-004 template`, () => {});",
      `  it.skip("GOV-TST-005 skipped", () => {});`,
      `  xit("GOV-TST-006 x'd", () => {});`,
      `  it("escaped \\"quote\\" GOV-TST-007", () => {});`,
    ].join("\n"));
    expect(got.map((t) => [t.title.slice(0, 11), t.state])).to.deep.equal([
      ["GOV-TST-002", "passed"], ["GOV-TST-003", "passed"], ["GOV-TST-004", "passed"],
      ["GOV-TST-005", "pending"], ["GOV-TST-006", "pending"], ["escaped \\\"q", "passed"],
    ]);
    expect(covered("GOV-TST-007", got)).to.equal(true);
    expect(covered("GOV-TST-005", got), "a skipped test is not proof").to.equal(false);
    expect(covered("GOV-TST-00", got), "an id is matched whole, never as a prefix").to.equal(false);
  });

  it("fails the build for a spec rule with no tagged test (P1 ruling), naming each id and its spec section", () => {
    const missing = promises.filter((r) => !covered(r.id, tests) && !(r.id in KNOWN_UNKEPT));
    expect(
      missing.map((r) => `${r.id} (${sectionName(r)}): ${r.expectation}`),
      "each of these gov-client promises has no test titled with its id. Write one that FAILS if the promise " +
        "breaks and put the id in its it(\"…\") title — or, if the code does not keep the promise, add it to " +
        "KNOWN_UNKEPT with what is missing (and raise it as work).",
    ).to.deep.equal([]);
  });

  it("KNOWN_UNKEPT is exact: every entry is an uncovered spec rule, so the list can only shrink", () => {
    const stale = Object.keys(KNOWN_UNKEPT).flatMap((id) => {
      const row = promises.find((r) => r.id === id);
      if (!row) return [`${id}: no longer an in-force spec rule — remove it from KNOWN_UNKEPT`];
      if (covered(id, tests)) return [`${id} (${sectionName(row)}): now has a tagged test — remove it from KNOWN_UNKEPT`];
      return [];
    });
    expect(stale).to.deep.equal([]);
  });
});

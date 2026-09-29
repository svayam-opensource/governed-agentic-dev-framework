// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * EVERY POL NUMBER CITED IN GOV'S SOURCE MUST RESOLVE TO A LIVE CLAUSE.
 *
 * This is `spec-anchors.test.ts` pointed the other way. That one asks "does the document still describe the
 * code?"; this one asks "does the code still cite a rule that exists?".
 *
 * It exists because of a failure I caused. The reduction of 2026-09-29 moved roughly half of `framework-policy.md`
 * into the specification, and before committing I grepped the shipped `.md` files for references to the sections
 * that departed — found eight, fixed eight. I never grepped `.ts`. Seventeen POL numbers cited in source resolved
 * to no clause afterwards, FOURTEEN of them because of that commit: a reader of `identity.ts` was pointed at
 * POL-069 for the branch grammar, `join.ts` at POL-047 for authorization, `seed.ts` at POL-168 for a refusal it
 * still issues. The reduction existed to stop documents asserting things that are not true, and it left fourteen
 * comments citing rules nobody can read.
 *
 * WHY A CITATION MATTERS MORE THAN IT LOOKS. The POL lock is append-only, so each number still resolves *there* —
 * you can look up POL-069 in `.pol-lock.json` and learn which clause it once was. What you cannot do is read the
 * clause, because it left the document. So a stale citation is a dead link rather than a wrong one, and it is
 * worse than a plain comment: it tells a maintainer that a ratified rule backs this code, and invites them to
 * treat the code as fixed by governance when nothing governs it at all.
 *
 * THE HARD PART, and the reason this test has an allow-list. Some citations are HISTORICAL by design — a comment
 * explaining a past defect necessarily names the numbers involved in it, and those numbers are retired precisely
 * because the defect was fixed. `pol-lock.ts` explains that the document once said POL-009c while the lock
 * recorded POL-185 for the same sentence; both numbers must appear, and neither will ever resolve again. A test
 * that failed on those would be wrong, would be argued with, and would be deleted. So historical citations are
 * listed explicitly, each with the reason it is one. Adding to that list requires writing the reason down, which
 * is the point: it is cheap to do honestly and conspicuous to abuse.
 */
import { expect } from "chai";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

function repoRoot(): string {
  let d = fileURLToPath(new URL(".", import.meta.url));
  for (let i = 0; i < 10; i++) {
    if (fs.existsSync(path.join(d, "publish", "content", "MANIFEST.yaml"))) return d;
    const parent = path.dirname(d);
    if (parent === d) break;
    d = parent;
  }
  throw new Error("could not locate the repo root");
}

const ROOT = repoRoot();
const SRC = path.join(ROOT, "publish", "actions", "ts", "src");
const POLICY_DIRS = [
  path.join(ROOT, "publish", "content", "framework", "policies"),
  path.join(ROOT, "publish", "content", "policies"),
];

/**
 * Citations that name a RETIRED number on purpose. Each entry says why, and the reason has to be the comment's
 * own subject — "it explains a past defect" — never "it was inconvenient to fix".
 */
const HISTORICAL: Readonly<Record<string, string>> = {
  "POL-009a": "rules-build.ts explains how a clause with a number but no modal verb went invisible and the lock "
    + "kept pointing at its old section. The clause is the example; retiring it does not unmake the lesson.",
  "POL-009c": "the pair POL-009c/POL-185 IS the defect pol-lock.ts documents — the document declared one number "
    + "while the lock allocated another for the same sentence. Both must be named for the story to parse.",
  "POL-185": "the other half of the POL-009c/POL-185 pair above — the number the lock allocated while the "
    + "document declared POL-009c. Naming only one of the two would leave the comment describing a mismatch "
    + "between a number and nothing.",
  "POL-168": "seed.ts's comment records that this number was cited by a refusal and exists in NO policy "
    + "document, and never has. The comment has to name it to say so; that is the whole point of the comment.",
};

/**
 * A DECISION THE POLICY OWNER HAS NOT MADE YET — not an exemption, a tracked backlog.
 *
 * Kept apart from `HISTORICAL` on purpose. A historical citation is permanently fine; one of these is a citation
 * that is wrong today and stays wrong until somebody rules on it. Mixing the two would let the second hide inside
 * the first, and the count below is what stops this list becoming the way the test is worked around.
 */
const PENDING_DECISION: Readonly<Record<string, string>> = {
  "POL-040a": "§3.3's four branch-protection controls. The reduction of 2026-09-29 moved them to the "
    + "specification because gov configures them — but by the (a)/(b)/(c) taxonomy they are (b) FIXED WITH "
    + "SETTINGS (gov installs them; the organization chooses `governance_posture`), and (b) belongs in policy "
    + "prose. So the reduction probably got this one wrong. ~45 sites depend on it, including the user-visible "
    + "`POL-040a.1`…`.4` labels `gov repo protect plan` prints per control, so restoring or renaming is a "
    + "governance decision and not a comment sweep.",
  "POL-040b": "the same decision. It stated the consequence when the platform can enforce nothing, which §3.4 "
    + "now carries as prose; whether that consequence needs a citable number follows from POL-040a's answer.",
};

/** Every `.ts` under src/, recursively. */
function sources(dir: string, out: string[] = []): string[] {
  for (const n of fs.readdirSync(dir)) {
    const p = path.join(dir, n);
    if (fs.statSync(p).isDirectory()) sources(p, out);
    else if (n.endsWith(".ts")) out.push(p);
  }
  return out;
}

/** Every POL number any shipped policy document declares or discusses. */
function liveNumbers(): Set<string> {
  const live = new Set<string>();
  for (const dir of POLICY_DIRS) {
    if (!fs.existsSync(dir)) continue;
    for (const n of fs.readdirSync(dir)) {
      if (!n.endsWith(".md")) continue;
      for (const m of fs.readFileSync(path.join(dir, n), "utf8").matchAll(/POL-\d{3}[a-z]?/g)) live.add(m[0]);
    }
  }
  return live;
}

describe("POL citations in gov's source resolve to a live clause", () => {
  const live = liveNumbers();
  const files = sources(SRC);

  it("the corpus is big enough for the assertion to mean something", () => {
    // A guard against the shape that made `shipped-knowledge.test.ts` pass while examining zero documents: if the
    // discovery ever returns nothing, this test would report green on a repository in any state at all.
    expect(files.length, "source files discovered").to.be.greaterThan(100);
    expect(live.size, "POL numbers found in the shipped policies").to.be.greaterThan(50);
  });

  it("every cited number is either live or listed as historical, with a reason", () => {
    const dangling: string[] = [];
    for (const file of files) {
      const rel = path.relative(SRC, file);
      const text = fs.readFileSync(file, "utf8");
      const cited = new Set([...text.matchAll(/POL-\d{3}[a-z]?/g)].map((m) => m[0]));
      for (const pol of cited) {
        if (live.has(pol) || pol in HISTORICAL || pol in PENDING_DECISION) continue;
        const line = text.split("\n").findIndex((l) => l.includes(pol)) + 1;
        dangling.push(`${pol} at ${rel}:${line}`);
      }
    }
    expect(
      dangling,
      "each of these tells a maintainer that a ratified rule backs the code, and points at a clause that is in no "
        + "document. Either cite the clause that survived, cite `framework/docs/specs/gov-behaviour.md` where the "
        + "rule became specification, or add it to HISTORICAL with the reason it names a retired number.",
    ).to.deep.equal([]);
  });

  it("the historical list stays small and every entry carries its reason", () => {
    // Not a style rule. This list is the only way to make the test above pass without fixing anything, so its
    // size is the measure of how much the mechanism is being worked around.
    expect(Object.keys(HISTORICAL).length, "historical exemptions").to.be.at.most(6);
    for (const [pol, why] of Object.entries(HISTORICAL)) {
      expect(why.length, `${pol}'s reason is too short to be a reason`).to.be.greaterThan(60);
    }
  });

  it("the pending-decision backlog only shrinks", () => {
    // Pinned, like the anchor count in spec-anchors.test.ts. Two numbers await one ruling; when it lands, both
    // leave together and this number goes to 0. It must never go up without the same commit explaining why a NEW
    // citation was allowed to dangle.
    expect(Object.keys(PENDING_DECISION)).to.deep.equal(["POL-040a", "POL-040b"]);
  });

  it("every historical entry is actually still cited — a stale exemption hides the next real one", () => {
    const allText = files.map((f) => fs.readFileSync(f, "utf8")).join("\n");
    for (const pol of [...Object.keys(HISTORICAL), ...Object.keys(PENDING_DECISION)]) {
      expect(allText, `${pol} is exempted but no longer cited anywhere — remove the exemption`).to.contain(pol);
    }
  });
});

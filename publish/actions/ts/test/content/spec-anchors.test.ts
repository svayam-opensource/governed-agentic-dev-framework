// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * THE SPECIFICATION IS HAND-WRITTEN. THIS IS WHAT MAKES THAT SAFE.
 *
 * `framework/docs/specs/gov-behaviour.md` describes what the gov clients do. It is written rather than generated
 * because a specification has to explain WHY, and no generator does that. The cost of hand-writing it is that it
 * can drift from the code, and "we update the document when the code changes" is a discipline, not a mechanism.
 *
 * We know the discipline does not hold, because it already failed: a C01 clause asserted that knowledge close used a
 * branch named `BRNCH-<board#>-<slug>-knowledge`. No code ever created it. The clause was C01 — the level that
 * admits no exception — and it was false for as long as anybody had been reading it. Nothing in the repository
 * noticed, because nothing was looking.
 *
 * So every CONCRETE literal the specification names — a branch pattern, a tag, a file name, a settings key, a
 * function — is paired here with the source that must contain it. Both directions fail:
 *
 *   · the literal vanishes from the code  → the spec is describing something that no longer exists
 *   · the literal vanishes from the spec  → the spec stopped naming a thing it is supposed to specify
 *
 * That second direction matters as much as the first. A spec that quietly loses a sentence is how §3.3 came to
 * assert a control that could not be installed. This is deliberately a DOZEN-ish anchors and not a hundred: the
 * point is to catch a factual claim going stale, not to re-derive the document.
 *
 * WHAT THIS TEST DOES NOT DO: judge the prose. The reasoning, the failure stories, the "why" — none of that is
 * checkable, and all of it is the reason the document is written by a person.
 *
 * AND ONE HONEST LIMIT, measured rather than assumed: the spec-side assertion is "the document names this literal
 * SOMEWHERE", not "this sentence still says it". Renaming the archive tag in the spec's §2 table was verified to
 * pass, because §3 names it too. The code-side assertion is the strict one and was verified to fail on a planted
 * rename in `merge.ts`. That asymmetry is fine and intended: drift arrives from the code, which is the side that
 * gets refactored. A person deleting a sentence from a specification is doing it on purpose.
 */
import { expect } from "chai";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

/** Walk up to the repo root (the folder holding `publish/`). */
function repoRoot(): string {
  let d = fileURLToPath(new URL(".", import.meta.url));
  for (let i = 0; i < 10; i++) {
    if (fs.existsSync(path.join(d, "publish", "content", "MANIFEST.yaml"))) return d;
    const parent = path.dirname(d);
    if (parent === d) break;
    d = parent;
  }
  throw new Error("could not locate the repo root (the folder holding publish/content/MANIFEST.yaml)");
}

const ROOT = repoRoot();
const SPEC_REL = "publish/content/framework/docs/specs/gov-behaviour.md";
const SRC = path.join(ROOT, "publish", "actions", "ts", "src");

const spec = fs.readFileSync(path.join(ROOT, SPEC_REL), "utf8");

function source(rel: string): string {
  const p = path.join(SRC, rel);
  if (!fs.existsSync(p)) throw new Error(`the spec's anchor names ${rel}, which does not exist under src/`);
  return fs.readFileSync(p, "utf8");
}

/**
 * One anchored fact.
 *
 * `inSpec` and `inCode` differ on purpose: the spec writes a pattern a person reads (`BRNCH-<board#>-<slug>`)
 * while the code writes the template that produces it (`` `BRNCH-${…}` ``). Pinning both is the whole point —
 * it is the PAIR that can rot.
 */
interface Anchor {
  /** What is being claimed, for the failure message. */
  readonly what: string;
  /** The literal as the specification writes it. */
  readonly inSpec: string;
  /** The literal as the code writes it. */
  readonly inCode: string;
  /** The source file that must contain `inCode`, relative to `src/`. */
  readonly file: string;
}

const ANCHORS: readonly Anchor[] = [
  // §2 — identity. The project id, project branch and task sub-branch anchors were RETIRED by W9 (rule model): they
  // are the spec rule GOV-FRM-453, whose tagged tests (identity.test.ts, task-run.test.ts) assert the exact strings
  // gov composes — a stronger check than "the template text is still in identity.ts" — and whose row pins
  // framework-specification.md §4.3, which names all three patterns, by sha (framework-rules.test.ts).
  { what: "the archive tag", inSpec: "archive/<branch>", inCode: "`archive/${branch}`", file: "lifecycle/merge.ts" },
  { what: "the knowledge proposal branch", inSpec: "knowledge-<slug>", inCode: "`knowledge-${slug}`", file: "lifecycle/knowledge.ts" },

  // §2 — the lifecycle states the spec says are derived. If the union gains or loses a member, the list is wrong.
  { what: "the derived lifecycle states", inSpec: "`paused`, `completed`, `cancelled`", inCode: '"active" | "paused" | "completed" | "cancelled"', file: "lifecycle/state.ts" },

  // §3 — the base branch a code repo is cut from, which the spec says `gov seed` can override.
  { what: "the code repos' base branch setting", inSpec: "`default_code_branch`", inCode: "default_code_branch", file: "config/org-config.ts" },

  // §5 — the read-only snapshot, and the harness.
  { what: "the ratified-governance snapshot directory", inSpec: ".gov/governance/", inCode: "`${projectDir}/.gov/governance`", file: "lifecycle/governance-snapshot.ts" },
  { what: "the file that must be in an agent's context before launch", inSpec: "`verifyAgentContext`", inCode: "export function verifyAgentContext", file: "lifecycle/root-protocol.ts" },

  // §6 — what `gov rules build` writes.
  // The POL lock anchor was RETIRED with the old compiler (P3 cutover): there is no lock to name.
  { what: "the rule map", inSpec: "`agent/harness/rule-map.md`", inCode: "RULE_MAP_PATH = `${HARNESS_DIR}/rule-map.md`", file: "rules/rules-build.ts" },
  { what: "the rule id cited in gov's own source", inSpec: "`GOV-FRM-423`", inCode: "GOV-FRM-423", file: "log.ts" },

  // §7 — the posture, and the limit the platform imposes.
  { what: "the governance posture setting", inSpec: "`governance_posture`", inCode: "governance_posture", file: "config/org-config.ts" },
  { what: "GitHub's refusal on a private repo on the Free plan", inSpec: "Upgrade to GitHub\nPro or make this repository public", inCode: "Upgrade to GitHub Pro or make this repository public", file: "lifecycle/branch-protection.ts" },
];

describe("gov-behaviour.md — every literal it names is anchored in the code", () => {
  for (const a of ANCHORS) {
    it(`${a.what}: the spec and ${a.file} agree`, () => {
      expect(
        spec,
        `the specification no longer names ${a.what} (looked for ${JSON.stringify(a.inSpec)}). Either restore the ` +
          `sentence, or remove this anchor because the spec deliberately stopped specifying it.`,
      ).to.contain(a.inSpec);
      expect(
        source(a.file),
        `the spec says ${a.what} is ${JSON.stringify(a.inSpec)}, but ${a.file} no longer contains ` +
          `${JSON.stringify(a.inCode)}. The code moved and the document did not — this is the false knowledge-close clause happening again.`,
      ).to.contain(a.inCode);
    });
  }

  it("names as many literals as it has anchors — a shrinking anchor set is how a spec stops being checked", () => {
    // Not a coverage assertion, a tripwire. If somebody deletes anchors to make a build pass, the count moves and
    // the diff shows it. Update the number deliberately, in the same commit as the reason.
    expect(ANCHORS.length).to.equal(10);
  });
});

describe("gov-behaviour.md — the negative anchor (the false knowledge-close clause)", () => {
  /**
   * The clause that justified this whole test file. It said knowledge close used a branch named
   * `BRNCH-<board#>-<slug>-knowledge` — a name DERIVED from the project's identity. That is the shape to look
   * for, and the first draft of this test looked for the bare suffix instead, which found two innocent things:
   * `project-knowledge` (a validator's name) and `onboard-knowledge` (a real branch, but a FIXED name belonging
   * to `gov onboard`, not derived from any project). The loose version would have failed for ever on code that
   * was never what that clause described — and a test that fails for the wrong reason gets deleted, not fixed.
   *
   * So: a `-knowledge` suffix applied to a branch, id, slug or project expression. Nothing else.
   */
  const DERIVED_KNOWLEDGE_BRANCH = [
    /\$\{[^}]*(branch|pid|projectId|project|slug)[^}]*\}-knowledge/i, // `${branch}-knowledge`
    /BRNCH-[^`"']*-knowledge/, //                                       a literal project branch + suffix
    /(branch|pid|projectId)\s*\+\s*["'`]-knowledge/i, //                 branch + "-knowledge"
  ];

  it("no branch is composed by suffixing a project branch with `-knowledge`", () => {
    const hits: string[] = [];
    const walk = (dir: string): void => {
      for (const n of fs.readdirSync(dir)) {
        const p = path.join(dir, n);
        if (fs.statSync(p).isDirectory()) walk(p);
        else if (n.endsWith(".ts")) {
          const text = fs.readFileSync(p, "utf8");
          if (DERIVED_KNOWLEDGE_BRANCH.some((re) => re.test(text))) hits.push(path.relative(SRC, p));
        }
      }
    };
    walk(SRC);
    expect(
      hits,
      "the specification states that no branch is derived from a project branch by suffixing it. If one now is, " +
        "the spec is wrong and that clause was right after all — which would be a genuinely interesting discovery.",
    ).to.deep.equal([]);
  });

  it("the spec says so, in as many words, and names the two fixed branches that DO exist", () => {
    expect(spec).to.contain("no branch is derived from a project branch by suffixing");
    // Naming them is the part that keeps the claim honest: "there is no -knowledge branch" was itself too strong.
    expect(spec).to.contain("`onboard-knowledge` from `gov onboard`");
  });

  it("`onboard-knowledge` is a fixed name, which is why it does not contradict the spec", () => {
    expect(source("lifecycle/onboard.ts")).to.contain('ONBOARD_BRANCH = "onboard-knowledge"');
  });
});

describe("gov-behaviour.md — it is a specification, not a policy", () => {
  /**
   * THE ONE RULE ABOUT THIS DOCUMENT'S FORM. A POL number is citable, and a citable number invites an exception
   * request — you cannot be excepted from how a program behaves. The split (2026-09-29) exists because the policy
   * used to contain both kinds of content, and a reader could not tell which sentences they were able to break.
   *
   * Since the rule model (W3) it names none at all: POL numbers are retired, and the two it once mentioned in
   * explaining itself are now described in words.
   */
  it("declares no POL numbers of its own", () => {
    const cited = new Set((spec.match(/POL-\d+[a-z]?/g) ?? []));
    const unexpected = [...cited];
    expect(
      unexpected,
      "a POL number in the specification reads as a rule somebody may request an exception from. Either the " +
        "sentence belongs in the policy, or the citation should name the policy rather than carry a number here.",
    ).to.deep.equal([]);
  });

  it("says plainly which of the two it is, in its first line of prose", () => {
    // A reader who opens the file in the middle of a review must not have to infer this.
    expect(spec).to.contain("**This is a specification, not a policy.**");
  });

  it("is not compiled into what an agent carries", () => {
    // The resident block is built from `framework/policies/` and `policies/`. A spec under `framework/docs/`
    // cannot reach it — which is the point: an agent carries rules, not documentation.
    expect(SPEC_REL).to.contain("framework/docs/specs/");
    expect(SPEC_REL, "a document under policies/ WOULD compile into the harness").to.not.contain("/policies/");
  });
});

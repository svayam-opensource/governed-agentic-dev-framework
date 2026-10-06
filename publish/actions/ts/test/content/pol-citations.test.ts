// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * NO NEW POL CITATIONS (rule-model-design.md Q21; W3, 2026-10-06).
 *
 * POL numbers are retired. A rule is cited by its GOV id, and a POL number anybody still meets — in an old commit,
 * a review, a knowledge file — resolves through `framework/rules/pol-aliases.yaml` (`gov rules show POL-…`).
 *
 * So this test pins WHICH FILES may still contain a POL number, and why. Membership is asserted EXACTLY, in both
 * directions:
 *
 *   · a file not on the list gains a POL number   → fail: cite the GOV id instead
 *   · a file on the list no longer has one        → fail: take it off the list
 *
 * The second direction is what makes the list shrink-only: an entry cannot outlive its reason, so it cannot sit
 * there waiting for the next citation to creep in under it. Adding an entry means writing down why the POL number
 * is DATA there (the old compiler's input, a fixture) or HISTORY (not ours to rewrite) — never "it was easier".
 *
 * This replaces the test that lived here before the rule model, which asked "does every POL number cited in src
 * resolve to a live clause?". Its successor question is the last test below: every GOV-FRM id cited in src is a
 * row of `framework/rules/rules.yaml`.
 */
import { expect } from "chai";
import * as fs from "node:fs";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { parseRuleStore } from "../../src/rules/model/rule-row.js";

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

// ── why a file may still hold a POL number ──────────────────────────────────────────────────────────────────
const DATA_FIXTURE = "a test fixture whose POL number is data: an old exception file citing one, the compliance "
  + "record's legacy column, the GOV-id parser's refusal of a POL id";
const ALIASES = "the POL → GOV resolution itself: the alias file, its loader, `gov rules show` and their tests";
const HISTORY = "history, not rewritten (Q21): a changelog, design records and working papers of their time";
const OUT_OF_SCOPE = "outside the gov CLI and its shipped content: a separate package or the deprecated bash CLI, "
  + "citing the publication-era org numbers; retire or rewrite with that code";
const PROCEDURES = "the legacy procedures document: its \"Governs:\" lines cite pre-reduction numbers that are "
  + "mostly retired; rewrite or retire it in P3 rather than alias forty stale citations";

/** Frozen. It may only SHRINK. */
const ALLOWED: Readonly<Record<string, string>> = {
  "CHANGELOG.md": HISTORY,
  "docs/design/agent-context-assembly-spec.md": HISTORY,
  "docs/design/option-2-sequence-diagrams.md": HISTORY,
  "publish/content/framework/rules/W2-classification.md": HISTORY,
  "publish/content/framework/procedures/agentic-development-procedures.md": PROCEDURES,
  "publish/content/framework/rules/pol-aliases.yaml": ALIASES,
  "publish/content/framework/docs/specs/gov-command-reference.md": ALIASES
    + " (generated from help-spec.ts, whose `gov rules show` example resolves a POL number)",
  "publish/actions/ts/src/cli/help-spec.ts": ALIASES + " (the `gov rules show` example)",
  "publish/actions/ts/src/cli/rules-show.ts": ALIASES,
  "publish/actions/ts/src/rules/model/pol-aliases.ts": ALIASES,
  "publish/actions/ts/test/cli/rules-show.test.ts": ALIASES,
  "publish/actions/ts/test/rules/model/pol-aliases.test.ts": ALIASES,
  "publish/actions/ts/test/rules/compliance-record.test.ts": DATA_FIXTURE,
  "publish/actions/ts/test/rules/exceptions.test.ts": DATA_FIXTURE,
  "publish/actions/ts/test/rules/model/model.test.ts": DATA_FIXTURE,
  "packages/knowledge-site/.gitignore": OUT_OF_SCOPE,
  "packages/knowledge-site/README.md": OUT_OF_SCOPE,
  "packages/knowledge-site/quartz.config.ts": OUT_OF_SCOPE,
  "packages/knowledge-site/quartz/plugins/svayam/domainIndex.ts": OUT_OF_SCOPE,
  "packages/knowledge-site/quartz/plugins/svayam/readmeAsIndex.ts": OUT_OF_SCOPE,
  "packages/knowledge-site/quartz/plugins/svayam/roleBrowse.ts": OUT_OF_SCOPE,
  "packages/knowledge-site/scripts/prepare-content.mjs": OUT_OF_SCOPE,
  "packages/svm-rag/README.md": OUT_OF_SCOPE,
  "packages/svm-rag/docs/svm-util-harness-waiver.md": OUT_OF_SCOPE,
  "packages/svm-rag/src/api/rest.ts": OUT_OF_SCOPE,
  "packages/svm-rag/src/chunk/chunker.ts": OUT_OF_SCOPE,
  "packages/svm-rag/src/chunk/exclude.ts": OUT_OF_SCOPE,
  "packages/svm-rag/src/meta/metadata.ts": OUT_OF_SCOPE,
  "packages/svm-rag/test/chunker.test.ts": OUT_OF_SCOPE,
  "packages/svm-rag/test/exclude.test.ts": OUT_OF_SCOPE,
  "publish/actions/deprecated/prj": OUT_OF_SCOPE,
  "publish/actions/deprecated/scripts/add-repo.sh": OUT_OF_SCOPE,
  "publish/actions/deprecated/scripts/cancel.sh": OUT_OF_SCOPE,
  "publish/actions/deprecated/scripts/close-knowledge.sh": OUT_OF_SCOPE,
  "publish/actions/deprecated/scripts/close-project.sh": OUT_OF_SCOPE,
  "publish/actions/deprecated/scripts/create-task.sh": OUT_OF_SCOPE,
  "publish/actions/deprecated/scripts/creds.sh": OUT_OF_SCOPE,
  "publish/actions/deprecated/scripts/join.sh": OUT_OF_SCOPE,
  "publish/actions/deprecated/scripts/lib.sh": OUT_OF_SCOPE,
  "publish/actions/deprecated/scripts/merge-task.sh": OUT_OF_SCOPE,
  "publish/actions/deprecated/scripts/onboard-repo.sh": OUT_OF_SCOPE,
  "publish/actions/deprecated/scripts/pause.sh": OUT_OF_SCOPE,
  "publish/actions/deprecated/scripts/propose-knowledge.sh": OUT_OF_SCOPE,
  "publish/actions/deprecated/scripts/resume.sh": OUT_OF_SCOPE,
  "publish/actions/deprecated/scripts/seed.sh": OUT_OF_SCOPE,
  "publish/actions/deprecated/scripts/sync.sh": OUT_OF_SCOPE,
  "publish/actions/deprecated/scripts/validate/check_knowledge.py": OUT_OF_SCOPE,
  "publish/actions/deprecated/scripts/validate/check_secrets.py": OUT_OF_SCOPE,
  "publish/actions/deprecated/setup.sh": OUT_OF_SCOPE,
  "publish/actions/deprecated/tests/e2e_smoke.sh": OUT_OF_SCOPE,
  "publish/actions/deprecated/tests/test_secret_scanner.sh": OUT_OF_SCOPE,
};

/** Every tracked or untracked (not ignored) file in the repository that contains a POL number. */
function filesCitingPol(): string[] | null {
  try {
    const out = execFileSync("git", ["-C", ROOT, "grep", "--untracked", "-lE", "POL-[0-9]"], { encoding: "utf8" });
    return out.split("\n").filter(Boolean).sort();
  } catch (e) {
    // `git grep` exits 1 when nothing matches — a real answer. Anything else (no git, not a repository) is not.
    if ((e as { status?: number }).status === 1) return [];
    return null;
  }
}

describe("no new POL citations — POL numbers are retired (rule-model Q21)", () => {
  it("exactly the allow-listed files hold a POL number — the list may only shrink", function () {
    const found = filesCitingPol();
    if (found === null) this.skip();
    const allowed = Object.keys(ALLOWED).sort();
    const added = found!.filter((f) => !(f in ALLOWED));
    const gone = allowed.filter((f) => !found!.includes(f));
    expect(added, "these files now cite a POL number. Cite the GOV id instead — `gov rules show POL-…` names it, "
      + "and framework/rules/pol-aliases.yaml says what became of every old number").to.deep.equal([]);
    expect(gone, "these allow-listed files no longer hold a POL number. Take them off ALLOWED: the list only shrinks")
      .to.deep.equal([]);
  });

  it("the allow-list's size is pinned, so a change to it is a visible diff", () => {
    expect(Object.keys(ALLOWED)).to.have.lengthOf(51);
  });

  it("every GOV-FRM id cited in gov's source is a row of framework/rules/rules.yaml", () => {
    const rows = new Set(parseRuleStore(fs.readFileSync(path.join(ROOT, "publish", "content", "framework", "rules", "rules.yaml"), "utf8")).map((r) => r.id));
    const dangling: string[] = [];
    const walk = (dir: string): void => {
      for (const n of fs.readdirSync(dir)) {
        const p = path.join(dir, n);
        if (fs.statSync(p).isDirectory()) walk(p);
        else if (n.endsWith(".ts")) {
          for (const m of fs.readFileSync(p, "utf8").matchAll(/GOV-FRM-(\d{3,})/g)) {
            if (!rows.has(`GOV-FRM-${m[1]}`)) dangling.push(`GOV-FRM-${m[1]} in ${path.relative(SRC, p)}`);
          }
        }
      }
    };
    walk(SRC);
    expect([...new Set(dangling)], "a GOV id that names no rule is a dead citation").to.deep.equal([]);
  });
});

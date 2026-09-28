// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * THE EVIDENCE THAT THE GATE DOES ANYTHING — one failing changeset and one near-miss per predicate.
 *
 * A file-triggered `gov:check` used to be parsed, validated, rendered byte-stably into every harness, counted in
 * `gov doctor`'s CHECKED column — and evaluated by nothing. Nothing in the test suite noticed, because nothing
 * asserted that a bad changeset FAILS. That is the shape of the defect: a check with a typo in its attributes
 * reads as enforced and is not, and the only thing that can tell the two apart is a fixture that must fail.
 *
 * So every test below is a PAIR. The failing case proves the predicate fires; the near-miss proves it fires on
 * the right thing, which is the half that catches a pattern accidentally matching everything. A predicate with
 * only the first half is a predicate that could be `() => false` and still be green.
 */
import { expect } from "chai";
import { parseCheck, parseCueBlocks } from "../../src/rules/cue-block.js";
import {
  addedDependencies, checksForFiles, formatDiffChecks, listedIn, runDiffChecks, selectFileChecks, standaloneChecks,
  type ChangedFile,
} from "../../src/rules/diff-check.js";
import type { AttachedCheck } from "../../src/rules/verb-gate.js";

/** A check, parsed from exactly the text a policy author writes — so a typo in the fixture fails loudly here. */
const attached = (attrs: string, pol = "POL-210", section = "3.1"): AttachedCheck[] => {
  const { check, problems } = parseCheck(attrs);
  expect(problems, `the check itself must parse: ${problems.map((p) => p.message).join("; ")}`).to.deep.equal([]);
  return [{ pol, doc: "policies/org-policy.md", section, check: check! }];
};

/** A file the change ADDED: every line of `text` is an added line. The common case for a new manifest or module. */
const added = (path: string, text: string): ChangedFile =>
  ({ path, status: "added", addedLines: text.split("\n"), text });

/** A file the change MODIFIED: `add` is what the diff added, `text` what the file now says in full. */
const modified = (path: string, add: readonly string[], text: string): ChangedFile =>
  ({ path, status: "modified", addedLines: add, text });

const removed = (path: string): ChangedFile => ({ path, status: "deleted", addedLines: [], text: null });

/** No document to read — used where the check under test refers to none. */
const noDocs = (): null => null;

const messages = (r: { failures: readonly { message: string }[] }): string => r.failures.map((f) => f.message).join("\n");

/** The seeded `approved-technologies.md`, trimmed to what a membership test can be argued about. */
const APPROVED = `
## 1. Languages and runtimes
| TypeScript · Node.js LTS | services |
## 2. Testing
| mocha · chai | TypeScript unit tests |
| pytest | Python tests |
## 4. Runtime dependencies
| \`@svayam-opensource/svm-util-log\` | all logging |
| \`github.com/spf13/cobra\` | Go CLIs |
| \`org.apache.commons:commons-lang3\` (artifact \`commons-lang3\`) | Java utilities |
| \`requests\` | Python HTTP |
| \`express-session\` | session middleware |
`;

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
// list-membership — the clause that was not running, in all four manifest formats
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
describe("list-membership — an unapproved dependency, in each of the four manifest formats", () => {
  const check = attached("kind=list-membership when=**/package.json,**/go.mod,**/pom.xml,**/requirements.txt "
    + "list=policies/approved-technologies.md on_miss=fail");
  const run = (changed: readonly ChangedFile[]) =>
    runDiffChecks(check, changed, (p) => (p === "policies/approved-technologies.md" ? APPROVED : null));

  it("npm: an added dependency that is not on the list FAILS, and the message names the file and the package", () => {
    const r = run([modified("package.json", ['    "left-pad": "^1.3.0",'], '{"dependencies":{"left-pad":"^1.3.0"}}')]);
    expect(r.ok).to.equal(false);
    expect(messages(r)).to.contain("package.json");
    expect(messages(r)).to.contain("left-pad");
    expect(messages(r), "and it cites the clause, never 'a check failed'").to.contain("POL-210 (policies/org-policy.md §3.1)");
  });

  it("npm near-miss: an APPROVED dependency, and the non-dependency keys beside it, pass", () => {
    const r = run([modified("package.json", [
      '    "mocha": "^10.8.2",',
      '  "version": "1.2.3",',
      '  "name": "my-service",',
      '  "main": "./lib/index.js",',
      '  "type": "module",',
      '    "node": ">=24"',
      '    "@svayam-opensource/svm-util-log": "^1.1.0"',
    ], "{}")]);
    expect(r.failures, messages(r)).to.deep.equal([]);
  });

  it("npm: a scoped package NOT on the list still fails — the scope is part of the name", () => {
    const r = run([modified("package.json", ['    "@acme/secret-sauce": "^2.0.0"'], "{}")]);
    expect(messages(r)).to.contain("@acme/secret-sauce");
  });

  it("go.mod: an added require FAILS; the module/go/replace directives beside it are not dependencies", () => {
    const bad = run([modified("go.mod", ["\tgithub.com/evil/pkg v1.4.0"], "module x")]);
    expect(messages(bad)).to.contain("github.com/evil/pkg");

    const nearMiss = run([modified("go.mod", [
      "module example.com/my-service",
      "go 1.22",
      "toolchain go1.22.3",
      "replace example.com/a => example.com/b v1.0.0",
      "exclude example.com/c v1.0.0",
      "\tgithub.com/spf13/cobra v1.8.0",
      "\tgolang.org/x/text v0.14.0 // indirect",
    ], "module example.com/my-service")]);
    expect(nearMiss.failures, `the four directives and the indirect requirement are not choices made here: ${messages(nearMiss)}`).to.deep.equal([]);
  });

  it("pom.xml: an artifactId inside <dependency> FAILS; the project's OWN artifactId does not", () => {
    const pom = `<project>
  <groupId>com.example</groupId>
  <artifactId>my-service</artifactId>
  <dependencies>
    <dependency>
      <groupId>com.evil</groupId>
      <artifactId>backdoor</artifactId>
    </dependency>
  </dependencies>
</project>`;
    const r = run([added("pom.xml", pom)]);
    expect(messages(r)).to.contain("backdoor");
    expect(messages(r), "a brand-new pom must not fail on its own coordinates — that is unfixable").to.not.contain("my-service");
  });

  it("pom.xml near-miss: an approved artifact inside <dependency> passes", () => {
    const pom = `<project>
  <artifactId>my-service</artifactId>
  <dependencies>
    <dependency><artifactId>commons-lang3</artifactId></dependency>
  </dependencies>
</project>`;
    expect(run([added("pom.xml", pom)]).failures, "commons-lang3 is listed").to.deep.equal([]);
  });

  it("requirements.txt: an added pin FAILS; comments, flags and approved pins do not", () => {
    const bad = run([modified("requirements.txt", ["shady-lib==0.0.1"], "shady-lib==0.0.1\n")]);
    expect(messages(bad)).to.contain("shady-lib");

    const nearMiss = run([modified("requirements.txt", [
      "# pinned by the platform team",
      "-r base.txt",
      "--index-url https://pypi.org/simple",
      "requests==2.32.3",
      "pytest>=8.0",
      'pytest ; python_version < "3.13"',
    ], "")]);
    expect(nearMiss.failures, messages(nearMiss)).to.deep.equal([]);
  });

  it("a package added under a NESTED manifest is caught too — the glob is `**/package.json`", () => {
    expect(messages(run([modified("services/web/package.json", ['"left-pad": "1.0.0"'], "{}")]))).to.contain("services/web/package.json");
  });

  it("a name that cannot be parsed is NOT a violation — under-reporting loses one finding, over-reporting loses the check", () => {
    // A lockfile-ish or unknown manifest shape contributes nothing rather than guessing.
    expect(addedDependencies(added("Gemfile", "gem 'rails', '~> 7.0'"))).to.deep.equal([]);
    expect(addedDependencies(added("package.json", ["  // a comment", "  freeform prose"].join("\n")))).to.deep.equal([]);
  });

  it("membership is a WHOLE-TOKEN match: `express` is not approved by the list's `express-session`", () => {
    expect(listedIn("express-session", APPROVED)).to.equal(true);
    expect(listedIn("express", APPROVED), "the substring reading approves a package nobody approved").to.equal(false);
    expect(listedIn("Mocha", APPROVED), "case is not the point of a list").to.equal(true);
  });

  it("an unreadable list= document WARNS loudly instead of approving everything in silence", () => {
    const r = runDiffChecks(check, [modified("package.json", ['"left-pad": "1.0.0"'], "{}")], noDocs);
    expect(r.failures).to.deep.equal([]);
    expect(r.warnings[0]!.message).to.contain("could not be read from the ratified branch");
    expect(r.warnings[0]!.message).to.contain("approved every dependency");
  });

  it("a DELETED manifest is skipped — a removal adds nothing to approve", () => {
    expect(run([removed("package.json")]).failures).to.deep.equal([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
// content-forbidden — the planted key
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
describe("content-forbidden — a planted API key in the ADDED lines, and not in anybody else's", () => {
  // `\x22` rather than a literal double quote: a quoted attribute value ends at the next `"`, so a pattern that
  // needs to match one spells it as an escape. Written with String.raw so the regex in the FIXTURE is the regex a
  // policy author types — a test that had to double its own backslashes would prove something else.
  const check = attached(
    String.raw`kind=content-forbidden when=**/*.ts pattern="(?:apiKey|api_key|api-key|secret)\s*[:=]\s*['\x22][^'\x22]{8,}" on_miss=fail`,
    "POL-220", "4");
  const run = (changed: readonly ChangedFile[]) => runDiffChecks(check, changed, noDocs);

  it("an added line carrying a key FAILS, and the message does NOT echo the secret", () => {
    const secret = 'const apiKey = "sk-live-9f2a1c4d8e7b6a5f";';
    const r = run([modified("src/client.ts", ["import x from \"y\";", secret], `x\n${secret}\n`)]);
    expect(r.ok).to.equal(false);
    expect(messages(r)).to.contain("src/client.ts");
    expect(messages(r), "printing the match would copy the secret into the CI log and the pull request")
      .to.not.contain("sk-live-9f2a1c4d8e7b6a5f");
  });

  it("near-miss: the SAME key already in the file, but not in the added lines, does not fail", () => {
    // A pre-existing match is somebody else's problem. Blocking on it blocks every unrelated change to the file
    // until the check is switched off — which is how the whole predicate gets lost.
    const secret = 'const apiKey = "sk-live-9f2a1c4d8e7b6a5f";';
    const r = run([modified("src/client.ts", ["// one new comment"], `${secret}\n// one new comment\n`)]);
    expect(r.failures, messages(r)).to.deep.equal([]);
  });

  it("near-miss: a short or templated value is not a key", () => {
    const r = run([modified("src/client.ts", ['const apiKey = process.env.API_KEY;', 'apiKey: ""'], "x")]);
    expect(r.failures, messages(r)).to.deep.equal([]);
  });

  it("a file the globs do not select is not judged at all", () => {
    expect(run([modified("docs/notes.md", ['api_key = "sk-live-9f2a1c4d8e"'], "x")]).failures).to.deep.equal([]);
  });

  it("a broken pattern= WARNS rather than aborting every other check in the pull request", () => {
    const r = runDiffChecks(attached("kind=content-forbidden when=**/*.ts pattern=( on_miss=fail"),
      [modified("src/a.ts", ["x"], "x")], noDocs);
    expect(r.failures).to.deep.equal([]);
    expect(r.warnings[0]!.message).to.contain("not a valid regular expression");
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
// content-required — the SPDX header (POL-203, verbatim from the seeded policy)
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
describe("content-required — a source file missing the SPDX header", () => {
  const spdx = attached("kind=content-required when=**/*.ts,**/*.js,**/*.py,**/*.go pattern=SPDX-License-Identifier on_miss=fail",
    "POL-203", "2.3");
  const run = (changed: readonly ChangedFile[], c = spdx) => runDiffChecks(c, changed, noDocs);

  it("a new source file with no header FAILS and says what to add", () => {
    const r = run([added("src/thing.ts", "export const x = 1;\n")]);
    expect(r.ok).to.equal(false);
    expect(messages(r)).to.contain("src/thing.ts");
    expect(messages(r)).to.contain("SPDX-License-Identifier");
  });

  it("near-miss: a one-line fix to an ALREADY compliant file passes — the whole text is what carries the header", () => {
    const r = run([modified("src/thing.ts", ["export const y = 2;"], "// SPDX-License-Identifier: MIT\nexport const y = 2;\n")]);
    expect(r.failures, messages(r)).to.deep.equal([]);
  });

  it("within_lines= means the first N lines, and a header pushed below them FAILS", () => {
    const c = attached("kind=content-required when=**/*.ts pattern=SPDX-License-Identifier within_lines=3 on_miss=fail");
    const body = ["", "", "", "", "// SPDX-License-Identifier: MIT"].join("\n");
    const r = run([added("src/late.ts", body)], c);
    expect(messages(r)).to.contain("within its first 3 line(s)");
    const ok = run([added("src/early.ts", "// SPDX-License-Identifier: MIT\nconst x = 1;")], c);
    expect(ok.failures, messages(ok)).to.deep.equal([]);
  });

  it("a DELETED source file is skipped — otherwise a non-compliant file could never be removed", () => {
    expect(run([removed("src/legacy.ts")]).failures).to.deep.equal([]);
  });

  it("an unreadable file WARNS: the check ran on nothing, and says so", () => {
    const r = run([{ path: "src/a.ts", status: "modified", addedLines: ["x"], text: null }]);
    expect(r.failures).to.deep.equal([]);
    expect(r.warnings[0]!.message).to.contain("could not be read");
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
// file-required — the behaviour change that brings no test (POL-202, verbatim)
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
describe("file-required — a src/ change with no test change", () => {
  const check = attached("kind=file-required when=src/**,lib/**,app/** require=test/**,tests/**,**/*.test.* on_miss=fail",
    "POL-202", "2.2");
  const run = (changed: readonly ChangedFile[]) => runDiffChecks(check, changed, noDocs);

  it("a change under src/ alone FAILS and names the file that triggered it", () => {
    const r = run([modified("src/order.ts", ["const total = 1;"], "x")]);
    expect(r.ok).to.equal(false);
    expect(messages(r)).to.contain("src/order.ts");
    expect(messages(r)).to.contain("test/**");
  });

  it("near-miss: the same change WITH a test in the same changeset passes", () => {
    const r = run([modified("src/order.ts", ["const total = 1;"], "x"), added("test/order.test.ts", "it(...)")]);
    expect(r.failures, messages(r)).to.deep.equal([]);
  });

  it("a changeset that touches nothing under src/ is not judged at all", () => {
    expect(run([modified("docs/README.md", ["a"], "a")]).failures).to.deep.equal([]);
  });

  it("a DELETION under src/ still needs the test change — removing behaviour is changing it", () => {
    expect(run([removed("src/order.ts")]).ok).to.equal(false);
    expect(run([removed("src/order.ts"), removed("test/order.test.ts")]).ok).to.equal(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
// frontmatter-required — the knowledge doc with no front matter
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
describe("frontmatter-required — a knowledge document missing front matter", () => {
  const check = attached("kind=frontmatter-required when=knowledge/**/*.md keys=domain,layer,owner,compliance,status on_miss=fail",
    "POL-408", "7.2");
  const run = (changed: readonly ChangedFile[]) => runDiffChecks(check, changed, noDocs);

  it("a doc with no front matter at all FAILS, naming every missing key", () => {
    const r = run([added("knowledge/decisions/why.md", "# Why\n\nbecause.\n")]);
    expect(r.ok).to.equal(false);
    expect(messages(r)).to.contain("knowledge/decisions/why.md");
    for (const k of ["domain", "layer", "owner", "compliance", "status"]) expect(messages(r), k).to.contain(k);
  });

  it("names only the keys that are MISSING, so the author knows which one to add", () => {
    const text = "---\ndomain: policies\nlayer: standard\nowner: policy-owner\n---\n# x";
    const r = run([added("knowledge/a.md", text)]);
    expect(messages(r)).to.contain("compliance");
    expect(messages(r)).to.contain("status");
    expect(messages(r)).to.not.contain("domain");
  });

  it("near-miss: a complete front-matter block passes", () => {
    const text = "---\ndomain: policies\nlayer: standard\nowner: policy-owner\ncompliance: C02\nstatus: draft\n---\n# x";
    expect(run([added("knowledge/a.md", text)]).failures).to.deep.equal([]);
  });

  it("near-miss: the keys must be IN the front matter, not merely somewhere in the prose", () => {
    const r = run([added("knowledge/a.md", "# x\n\ndomain: policies\nlayer: standard\nowner: me\ncompliance: C02\nstatus: draft\n")]);
    expect(r.ok, "a body that happens to mention the keys is not a front-matter block").to.equal(false);
  });

  it("a doc outside the globs, and a deleted doc, are not judged", () => {
    expect(run([added("docs/plain.md", "# x")]).failures).to.deep.equal([]);
    expect(run([removed("knowledge/gone.md")]).failures).to.deep.equal([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
// naming — the branch, and the path
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
describe("naming — a bad branch name, and a bad path", () => {
  const branchCheck = attached("kind=naming when=** subject=branch pattern=^BRNCH-[0-9]+-[a-z0-9-]+$ on_miss=fail",
    "POL-120", "3.4");

  it("a branch that does not match FAILS and says to rename it", () => {
    const r = runDiffChecks(branchCheck, [modified("src/a.ts", ["x"], "x")], noDocs, { branch: "feature/my-thing" });
    expect(r.ok).to.equal(false);
    expect(messages(r)).to.contain("feature/my-thing");
    expect(messages(r)).to.contain("rename the branch");
  });

  it("near-miss: the conventional name passes — and a name that merely CONTAINS it does not", () => {
    expect(runDiffChecks(branchCheck, [modified("src/a.ts", ["x"], "x")], noDocs, { branch: "BRNCH-121-doc-update" }).ok).to.equal(true);
    expect(runDiffChecks(branchCheck, [modified("src/a.ts", ["x"], "x")], noDocs, { branch: "wip-BRNCH-121-doc-update" }).ok,
      "an unanchored pattern would pass this").to.equal(false);
  });

  it("an unknown branch is a WARNING, not a violation — unknowable is not the developer's fault", () => {
    const r = runDiffChecks(branchCheck, [modified("src/a.ts", ["x"], "x")], noDocs);
    expect(r.ok).to.equal(true);
    expect(r.warnings[0]!.message).to.contain("not known here");
  });

  it("with no subject=, it judges the matching PATHS", () => {
    const c = attached(String.raw`kind=naming when=knowledge/**/*.md pattern=^knowledge/[a-z0-9/-]+\.md$ on_miss=fail`);
    const bad = runDiffChecks(c, [added("knowledge/Why_This.md", "x")], noDocs);
    expect(messages(bad)).to.contain("knowledge/Why_This.md");
    expect(runDiffChecks(c, [added("knowledge/why-this.md", "x")], noDocs).failures).to.deep.equal([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
// path-scope — the write outside the permitted scope
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
describe("path-scope — a write outside the permitted scope", () => {
  const check = attached("kind=path-scope when=** writable=projects/**,docs/** on_miss=fail", "POL-115", "4.1");
  const run = (changed: readonly ChangedFile[]) => runDiffChecks(check, changed, noDocs);

  it("a change to a read-only tree FAILS, counts the paths and names one", () => {
    const r = run([added("projects/PRJ-1/knowledge/a.md", "x"), modified("knowledge/policies/org-policy.md", ["x"], "x")]);
    expect(r.ok).to.equal(false);
    expect(messages(r)).to.contain("knowledge/policies/org-policy.md");
    expect(messages(r)).to.contain("1 changed path(s) outside");
  });

  it("near-miss: every path inside the scope passes", () => {
    expect(run([added("projects/PRJ-1/knowledge/a.md", "x"), added("docs/guide.md", "x")]).failures).to.deep.equal([]);
  });

  it("a DELETION outside the scope is a violation too — removing a file is a write", () => {
    expect(messages(run([removed("knowledge/policies/org-policy.md")]))).to.contain("org-policy.md");
  });

  it("an empty writable= WARNS instead of failing every change in the repository", () => {
    const r = runDiffChecks(attached("kind=path-scope when=** on_miss=fail"), [added("a.md", "x")], noDocs);
    expect(r.failures).to.deep.equal([]);
    expect(r.warnings[0]!.message).to.contain("permits nothing");
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
// selection, severity, and what the developer reads
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
describe("selecting the checks a changeset fires", () => {
  const doc = `### 3.1 Only approved technologies

A library not listed MAY be introduced only with an approved exception. **(POL-210)**

<!-- gov:cue generated clause-sha=fa2f24d -->
> **Always in the agent's context** · POL-210 · C02
> TECHNOLOGY CHOICES ARE NOT YOURS.

<!-- gov:check kind=list-membership when=**/package.json list=policies/approved-technologies.md on_miss=fail -->

### 4.1 Closing

A project MAY be closed only once its learnings are written up. **(POL-240)**

<!-- gov:cue generated clause-sha=abc1234 -->
> **Always in the agent's context** · POL-240 · C02
> WRITE UP WHAT YOU LEARNED.

<!-- gov:check kind=file-required when=verb:close require=knowledge/learnings.md on_miss=fail -->
`;

  it("picks the file-triggered checks whose globs match, and leaves the verb-triggered ones to the verb gate", () => {
    const { blocks } = parseCueBlocks("policies/org-policy.md", doc);
    expect(checksForFiles(blocks, [added("package.json", "{}")]).map((c) => c.pol)).to.deep.equal(["POL-210"]);
    expect(checksForFiles(blocks, [added("README.md", "x")]), "nothing matches these globs").to.deep.equal([]);
  });

  it("a check with NO CUE is found too — POL-203 in the shipped policy is exactly that, and ran on nothing", () => {
    // §6.3 of the seeded policy says a rule a machine can see in a diff should be *check only, no cue*, and POL-203
    // (`on_miss=fail`) takes it at its word. Read only as the tail of a cue block, the starter policy's most
    // emphatic clause was the least enforced one.
    const cueless = `### 2.3 Every source file carries the licence header

Every source file MUST carry the organization's SPDX licence identifier. **(POL-203)**

<!-- gov:check kind=content-required when=**/*.ts,**/*.go
     pattern=SPDX-License-Identifier on_miss=fail -->

*(No cue: a machine sees this in a diff perfectly well.)*
`;
    const found = standaloneChecks("policies/org-policy.md", cueless);
    expect(found.map((c) => `${c.pol} §${c.section} ${c.check.kind}`)).to.deep.equal(["POL-203 §2.3 content-required"]);
    const r = runDiffChecks(selectFileChecks(found, [added("src/a.ts", "const x = 1;")]), [added("src/a.ts", "const x = 1;")], noDocs);
    expect(r.ok).to.equal(false);
    expect(messages(r)).to.contain("POL-203 (policies/org-policy.md §2.3)");
  });

  it("a check that DOES belong to a cue is not collected twice — one clause, one finding", () => {
    const { blocks } = parseCueBlocks("policies/org-policy.md", doc);
    const changed = [added("package.json", "{}")];
    expect(checksForFiles(blocks, changed).map((c) => c.pol)).to.deep.equal(["POL-210"]);
    expect(selectFileChecks(standaloneChecks("policies/org-policy.md", doc), changed),
      "the blockquote above it says it is already owned").to.deep.equal([]);
  });

  it("a changeset with no checks attached reports nothing at all", () => {
    expect(runDiffChecks([], [added("a.ts", "x")], noDocs)).to.deep.equal({ ok: true, failures: [], warnings: [] });
  });

  it("on_miss=warn does not block — it is carried as a warning, exactly as at the verb gate", () => {
    const c = attached("kind=content-required when=**/*.ts pattern=SPDX on_miss=warn");
    const r = runDiffChecks(c, [added("src/a.ts", "const x = 1;")], noDocs);
    expect(r.ok).to.equal(true);
    expect(r.warnings).to.have.length(1);
  });

  it("a kind with no evaluator over a changeset WARNS rather than passing silently", () => {
    // The hand-written or newer-content case: the next predicate added to cue-block.ts must not be parsed,
    // rendered, counted as CHECKED and then evaluated by nothing — which is the defect this module fixes.
    const r = runDiffChecks(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- a kind cue-block.ts does not have yet
      [{ pol: "POL-9", doc: "d.md", section: "1", check: { kind: "future-kind" as any, trigger: { on: "files", globs: ["**"] }, attrs: {}, onMiss: "fail" } }],
      [added("a.ts", "x")], noDocs,
    );
    expect(r.ok).to.equal(true);
    expect(r.warnings[0]!.message).to.contain("checked nothing");
  });

  it("every finding cites the clause and the document section, so the rule can be read", () => {
    const r = runDiffChecks(attached("kind=content-required when=**/*.ts pattern=SPDX on_miss=fail"),
      [added("src/a.ts", "const x = 1;")], noDocs);
    expect(r.failures[0]!.pol).to.equal("POL-210");
    expect(r.failures[0]!.message).to.contain("POL-210 (policies/org-policy.md §3.1)");
  });

  it("the report marks failures and warnings differently, and is empty when there is nothing to say", () => {
    expect(formatDiffChecks({ ok: true, failures: [], warnings: [] })).to.deep.equal([]);
    const r = runDiffChecks(attached("kind=content-required when=**/*.ts pattern=SPDX on_miss=fail"),
      [added("src/a.ts", "x")], noDocs);
    expect(formatDiffChecks(r)[0]).to.match(/^ {2}✗ /);
  });
});

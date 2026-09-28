// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * A CHECK ATTACHED TO A COMMAND — the socket that lets an organization ask for what gov used to hardcode.
 *
 * The case these tests are written around is the real one: `gov close` insisted on a `knowledge-close.md` with
 * five exact headings, which nothing scaffolded and whose failure message sent a human to an agent protocol.
 * Removing that without this socket would have deleted the capability. So the tests hold two things: that an
 * organization can ask for exactly those five headings **in its own policy**, and that when the answer is "no"
 * the developer is told the file and the heading — never a protocol.
 */
import { expect } from "chai";
import { parseCheck, parseCueBlocks, GATEABLE_VERBS, type CueBlock } from "../../src/rules/cue-block.js";
import { checksForVerb, gateVerb, formatGate, type WorkspaceView } from "../../src/rules/verb-gate.js";
import { globToRegExp, matchesGlob, filterByGlobs } from "../../src/rules/glob.js";

/** A workspace as a plain map of path → contents. */
function ws(files: Record<string, string>, over: Partial<WorkspaceView> = {}): WorkspaceView {
  return {
    exists: (rel) => rel in files,
    read: (rel) => files[rel] ?? null,
    paths: () => Object.keys(files),
    ...over,
  };
}

const attached = (attrs: string, pol = "POL-240", section = "4.1") => {
  const { check, problems } = parseCheck(attrs);
  expect(problems, `the check itself must parse: ${problems.map((p) => p.message).join("; ")}`).to.deep.equal([]);
  return [{ pol, doc: "policies/org-policy.md", section, check: check! }];
};

describe("glob — the small grammar, and the two orderings that were wrong", () => {
  it("`**/` matches zero directories as well as many", () => {
    expect(matchesGlob("src/a.ts", "src/**/*.ts"), "the naive ordering fails this one").to.equal(true);
    expect(matchesGlob("src/deep/deeper/a.ts", "src/**/*.ts")).to.equal(true);
  });
  it("a leading `**/` matches a top-level file", () => {
    expect(matchesGlob("package.json", "**/package.json")).to.equal(true);
    expect(matchesGlob("web/package.json", "**/package.json")).to.equal(true);
  });
  it("`*` does not cross a slash", () => {
    expect(matchesGlob("src/a.ts", "src/*.ts")).to.equal(true);
    expect(matchesGlob("src/deep/a.ts", "src/*.ts")).to.equal(false);
  });
  it("a dot is a literal dot, not any character", () => {
    expect(matchesGlob("goXmod", "go.mod")).to.equal(false);
    expect(globToRegExp("go.mod").test("go.mod")).to.equal(true);
  });
  it("an EMPTY glob list matches nothing — never everything", () => {
    // The friendly reading ("no globs means all files") is the dangerous one: a check whose `when=` was
    // forgotten would apply to the whole repository, or pass vacuously.
    expect(filterByGlobs(["a.ts", "b.ts"], [])).to.deep.equal([]);
  });
});

describe("verb triggers — parsing", () => {
  it("reads `when=verb:close` as a verb trigger", () => {
    const { check, problems } = parseCheck("kind=content-required when=verb:close file=k/close.md pattern=x");
    expect(problems).to.deep.equal([]);
    expect(check!.trigger).to.deep.equal({ on: "verb", verb: "close" });
  });

  it("refuses a verb gov has no gate on, rather than accepting a check that never fires", () => {
    const { problems } = parseCheck("kind=file-required when=verb:deploy require=x");
    expect(problems[0]!.message).to.contain("gov has no gate on 'deploy'");
    expect(problems[0]!.message, "and it says which verbs exist").to.contain(GATEABLE_VERBS[0]);
  });

  it("refuses a MIXED trigger — one check, one moment", () => {
    const { problems } = parseCheck("kind=file-required when=verb:close,**/x.md require=y");
    expect(problems[0]!.message).to.contain("mixes a verb trigger with file globs");
  });

  it("refuses the two diff-only predicates on a verb, because 'added' has no meaning without a changeset", () => {
    for (const kind of ["list-membership", "content-forbidden"]) {
      const { problems } = parseCheck(`kind=${kind} when=verb:close list=x`);
      expect(problems.map((p) => p.message).join(" "), kind).to.contain("defined over a changeset");
    }
  });

  it("reports an absent when= instead of matching nothing quietly", () => {
    expect(parseCheck("kind=file-required require=x").problems[0]!.message).to.contain("no when=");
  });
});

describe("verb gate — selecting the checks that apply", () => {
  const doc = `### 4.1 Closing

A project MAY be closed only once its learnings are written up. **(POL-240)**

<!-- gov:cue generated clause-sha=abc1234 -->
> **Always in the agent's context** · POL-240 · C02
> WRITE UP WHAT YOU LEARNED before closing.

<!-- gov:check kind=file-required when=verb:close require=knowledge/learnings.md on_miss=fail -->

### 4.2 Dependencies

A dependency MAY be approved first. **(POL-241)**

<!-- gov:cue generated clause-sha=def5678 -->
> **Always in the agent's context** · POL-241 · C02
> CHECK THE LIST FIRST.

<!-- gov:check kind=list-membership when=**/package.json list=policies/approved.md on_miss=fail -->
`;
  it("picks only the checks attached to this verb", () => {
    const { blocks } = parseCueBlocks("policies/org-policy.md", doc);
    expect(checksForVerb(blocks, "close").map((c) => c.pol)).to.deep.equal(["POL-240"]);
    expect(checksForVerb(blocks, "merge"), "nothing is attached to merge").to.deep.equal([]);
  });
});

describe("verb gate — the five headings, asked for by an ORGANIZATION this time", () => {
  const check = "kind=content-required when=verb:close file=knowledge/knowledge-close.md "
    + 'sections="## Graduated to org knowledge,## Kept project-local,## Discarded" on_miss=fail';

  it("refuses when the file is absent, and names the file — not a protocol", () => {
    const r = gateVerb(attached(check), ws({ "knowledge/todo.md": "# todo" }));
    expect(r.ok).to.equal(false);
    expect(r.failures[0]!.message).to.contain("knowledge/knowledge-close.md");
    expect(r.failures[0]!.message).to.contain("does not exist");
    expect(r.failures.join(" "), "the old message sent a human to an agent protocol").to.not.match(/Protocol/);
  });

  it("names the MISSING heading, one finding each — not 'something is wrong'", () => {
    const r = gateVerb(attached(check), ws({ "knowledge/knowledge-close.md": "## Discarded\n- none\n" }));
    expect(r.failures).to.have.length(2);
    expect(r.failures.map((f) => f.message).join(" ")).to.contain("## Graduated to org knowledge");
    expect(r.failures.map((f) => f.message).join(" ")).to.contain("## Kept project-local");
  });

  it("passes when the organization's own requirement is met", () => {
    const text = "## Graduated to org knowledge\n-\n## Kept project-local\n-\n## Discarded\n-\n";
    expect(gateVerb(attached(check), ws({ "knowledge/knowledge-close.md": text })).ok).to.equal(true);
  });

  it("every finding cites the clause, so a developer can read the rule they hit", () => {
    const r = gateVerb(attached(check), ws({}));
    expect(r.failures[0]!.message).to.contain("POL-240");
    expect(r.failures[0]!.message).to.contain("policies/org-policy.md §4.1");
  });
});

describe("verb gate — the other predicates, and what they mean with no diff", () => {
  it("file-required: every glob must match something that exists", () => {
    const c = attached("kind=file-required when=verb:close require=knowledge/*.md,docs/*.md on_miss=fail");
    const r = gateVerb(c, ws({ "knowledge/a.md": "" }));
    expect(r.failures).to.have.length(1);
    expect(r.failures[0]!.message).to.contain("docs/*.md");
  });

  it("frontmatter-required: reports the file AND the missing keys", () => {
    const c = attached('kind=frontmatter-required when=verb:close paths=knowledge/*.md keys=domain,owner on_miss=fail');
    const r = gateVerb(c, ws({ "knowledge/a.md": "---\ndomain: policies\n---\n# a" }));
    expect(r.failures[0]!.message).to.contain("knowledge/a.md");
    expect(r.failures[0]!.message).to.contain("owner");
    expect(r.failures[0]!.message).to.not.contain("domain");
  });

  it("naming: judges the branch or the project id, and warns when it cannot know it", () => {
    const c = attached('kind=naming when=verb:close subject=branch pattern=^BRNCH- on_miss=fail');
    expect(gateVerb(c, ws({}, { branch: "BRNCH-7-x" })).ok).to.equal(true);
    expect(gateVerb(c, ws({}, { branch: "main" })).failures[0]!.message).to.contain("does not match");
    const unknown = gateVerb(c, ws({}));
    expect(unknown.ok, "unknowable is not a violation").to.equal(true);
    expect(unknown.warnings[0]!.message).to.contain("is not known here");
  });

  it("on_miss=warn does not block — it is carried as a warning", () => {
    const c = attached("kind=file-required when=verb:close require=nope.md on_miss=warn");
    const r = gateVerb(c, ws({}));
    expect(r.ok).to.equal(true);
    expect(r.warnings).to.have.length(1);
  });

  it("a diff-only predicate that somehow reaches the gate WARNS rather than passing silently", () => {
    // parseCheck refuses it, so this is the hand-written or older-CLI case. A check that silently does nothing
    // is the defect this design keeps finding; saying so is the minimum.
    const r = gateVerb(
      [{ pol: "POL-9", doc: "d.md", section: "1", check: { kind: "content-forbidden", trigger: { on: "verb", verb: "close" }, attrs: {}, onMiss: "fail" } }],
      ws({}),
    );
    expect(r.ok).to.equal(true);
    expect(r.warnings[0]!.message).to.contain("cannot run on a command");
  });
});

describe("verb gate — what the developer reads", () => {
  it("says what blocked, how many, and cites each clause", () => {
    const c = attached("kind=file-required when=verb:close require=a.md,b.md on_miss=fail");
    const out = formatGate(gateVerb(c, ws({})), "close").join("\n");
    expect(out).to.contain("gov close is blocked by 2 policy checks");
    expect(out).to.contain("POL-240");
    expect(out).to.contain("a.md");
  });

  it("says nothing at all when nothing is attached — a gate with no rules is silent", () => {
    expect(formatGate(gateVerb([], ws({})), "close")).to.deep.equal([]);
  });
});

/** A cue block with a check, for the selection test above. Kept last so the fixture reads after the behaviour. */
export type _Unused = CueBlock;

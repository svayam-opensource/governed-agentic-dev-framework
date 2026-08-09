import { expect } from "chai";
import { chunkDocument } from "../src/chunk/chunker.js";
import { chunkIdOf, slugify } from "../src/meta/frontmatter.js";

const DOC = `---
domain: policies
layer: mandate
owner: policy-owner
compliance: C01
status: current
---

# LLM Governance Policy

Intro paragraph in the preamble.

## Purpose

This policy governs which providers may be used.

## Provider / Model Tiers

### Approved
Anthropic is approved.

\`\`\`
## not-a-heading inside a fence
\`\`\`

Tier rules continue here.
`;

describe("chunker (per-## section)", () => {
  const chunks = chunkDocument({ raw: DOC, repoRelPath: "knowledge/policies/llm-governance.md", commitSha: "abc1234" });

  it("emits a preamble chunk plus one chunk per ## section", () => {
    const headings = chunks.map((c) => c.metadata.heading);
    expect(headings).to.deep.equal(["(preamble)", "Purpose", "Provider / Model Tiers"]);
  });

  it("does NOT split on a ## inside a code fence", () => {
    const tiers = chunks.find((c) => c.metadata.heading === "Provider / Model Tiers")!;
    expect(tiers.body).to.contain("## not-a-heading inside a fence");
    expect(tiers.body).to.contain("Tier rules continue here.");
  });

  it("prefixes embedding text with Document/Section for self-containment (POL-402)", () => {
    const purpose = chunks.find((c) => c.metadata.heading === "Purpose")!;
    expect(purpose.text.startsWith("Document: LLM Governance Policy\nSection: Purpose\n\n")).to.equal(true);
    // body (for /docs) carries NO prefix — never a second authority copy
    expect(purpose.body.startsWith("This policy governs")).to.equal(true);
  });

  it("promotes front-matter to metadata on every chunk", () => {
    for (const c of chunks) {
      expect(c.metadata.domain).to.equal("policies");
      expect(c.metadata.layer).to.equal("mandate");
      expect(c.metadata.domainOwner).to.equal("policy-owner");
      expect(c.metadata.compliance).to.equal("C01");
      expect(c.metadata.commitSha).to.equal("abc1234");
      expect(c.metadata.path).to.equal("knowledge/policies/llm-governance.md");
    }
  });

  it("uses a deterministic, stable chunkId = sha1(path#slug)", () => {
    const purpose = chunks.find((c) => c.metadata.heading === "Purpose")!;
    expect(purpose.chunkId).to.equal(chunkIdOf("knowledge/policies/llm-governance.md", slugify("Purpose")));
    expect(purpose.chunkId).to.match(/^[0-9a-f]{40}$/);
  });

  it("records a 1-based line span per section", () => {
    const purpose = chunks.find((c) => c.metadata.heading === "Purpose")!;
    expect(purpose.metadata.lineStart).to.be.greaterThan(0);
    expect(purpose.metadata.lineEnd).to.be.greaterThanOrEqual(purpose.metadata.lineStart!);
  });
});

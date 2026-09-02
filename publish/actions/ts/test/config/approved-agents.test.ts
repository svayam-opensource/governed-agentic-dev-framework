// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/** The approved-agent block in llm-governance.md (#196). */
import { expect } from "chai";
import { parseApprovedAgents, defaultAgent, renderApprovedAgents, withApprovedAgents } from "../../src/config/approved-agents.js";

const POLICY = `# LLM Governance Policy

### Approved

| Provider | Model | Notes |
|---|---|---|
| Anthropic | claude | Default |

\`\`\`yaml
approved_agents:
  - id: claude-code
    default: true
  - id: cursor
\`\`\`

### Provisional
Cursor is mentioned here too, in prose, and must not count.
`;

describe("gov-work — the approved-agent block (#196)", () => {
  it("reads ids and the default marker", () => {
    expect(parseApprovedAgents(POLICY)).to.deep.equal([{ id: "claude-code", default: true }, { id: "cursor" }]);
  });

  it("reads only the block — a provider named in prose is not an approval", () => {
    // The forgiving prose parser this replaces would have counted the Provisional
    // mention. Being wrong about a C01 list is the thing to avoid.
    const ids = parseApprovedAgents(POLICY)!.map((a) => a.id);
    expect(ids.filter((i) => i === "cursor")).to.have.length(1);
  });

  it("tells 'no block' apart from 'approved nothing'", () => {
    // One says the org has not decided; the other says it decided on nothing. The
    // fallback to framework defaults hangs on the difference.
    expect(parseApprovedAgents("# policy with no block")).to.equal(null);
    expect(parseApprovedAgents("```yaml\napproved_agents:\n```")).to.deep.equal([]);
    expect(parseApprovedAgents(null)).to.equal(null);
  });

  it("the default is the marked one, or the only one", () => {
    expect(defaultAgent([{ id: "a", default: true }, { id: "b" }])).to.equal("a");
    expect(defaultAgent([{ id: "solo" }]), "one approved is the default by definition").to.equal("solo");
    expect(defaultAgent([{ id: "a" }, { id: "b" }]), "two and no marker → ask").to.equal(null);
    expect(defaultAgent([])).to.equal(null);
  });

  it("round-trips what it renders", () => {
    const agents = [{ id: "claude-code", default: true }, { id: "cursor" }];
    expect(parseApprovedAgents(renderApprovedAgents(agents))).to.deep.equal(agents);
  });

  it("replaces an existing block rather than adding a second answer", () => {
    const out = withApprovedAgents(POLICY, [{ id: "cursor", default: true }])!;
    expect(out.match(/approved_agents:/g), "one block").to.have.length(1);
    expect(parseApprovedAgents(out)).to.deep.equal([{ id: "cursor", default: true }]);
    expect(out, "the human table is left alone").to.contain("| Anthropic | claude | Default |");
  });

  it("inserts under the Approved heading, with a note saying who may change it", () => {
    const bare = "# Policy\n\n### Approved\n\n| Provider |\n|---|\n\n### Provisional\n";
    const out = withApprovedAgents(bare, [{ id: "claude-code", default: true }])!;
    expect(out.indexOf("approved_agents:")).to.be.greaterThan(out.indexOf("### Approved"));
    expect(out.indexOf("approved_agents:"), "inside the section it governs").to.be.lessThan(out.indexOf("### Provisional"));
    expect(out).to.contain("gov agent approve");
    expect(out).to.contain("C01");
  });

  it("refuses to write when there is no Approved heading to anchor to", () => {
    // A block outside the section it governs is a block nobody will find.
    expect(withApprovedAgents("# Policy\n\nno headings here\n", [{ id: "x" }])).to.equal(null);
  });

  it("returns null when nothing would change", () => {
    expect(withApprovedAgents(POLICY, [{ id: "claude-code", default: true }, { id: "cursor" }])).to.equal(null);
  });
});

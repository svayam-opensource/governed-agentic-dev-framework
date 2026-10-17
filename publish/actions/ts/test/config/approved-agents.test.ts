// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/** The approved-agent block in llm-governance.md (#196). */
import { expect } from "chai";
import {
  parseApprovedAgents, defaultAgent, renderApprovedAgents, withApprovedAgents,
  parseAuthorizedAgents, readAuthorizedAgents, isStructureOnly, withAuthorizedAgents,
} from "../../src/config/approved-agents.js";

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

/**
 * STRUCTURE-ONLY: an organization that adopts gov for its PROCESS and runs no AI agents.
 *
 * The whole suite turns on one distinction — a DECISION to use none, versus a setup that has not
 * answered yet. They were the same value (`[]`), which is how an org that chose to run no agents
 * ended up being offered the framework's entire catalogue as its own defaults.
 */
describe("gov-work — authorized_agents: none (structure-only)", () => {
  const CFG = 'org_name: "Acme"\ngithub_org: "acme"\n';

  it("round-trips the decision: writing an empty list reads back as `none`", () => {
    const out = withAuthorizedAgents(CFG, [])!;
    expect(out, "the decision is a word, not an absence").to.contain("authorized_agents: none");
    expect(readAuthorizedAgents(out).kind).to.equal("none");
    expect(isStructureOnly(out)).to.equal(true);
    expect(parseAuthorizedAgents(out), "an empty LIST is the decision").to.deep.equal([]);
  });

  it("says, in the file, that this is an answer and how to change it", () => {
    const out = withAuthorizedAgents(CFG, [])!;
    expect(out).to.contain("runs no AI agents");
    expect(out).to.contain("gov agent approve");
  });

  it("'none was chosen' is NOT 'the key is missing'", () => {
    expect(readAuthorizedAgents(CFG).kind, "no key at all").to.equal("unset");
    expect(parseAuthorizedAgents(CFG), "which callers read as 'use the framework list, and say so'").to.equal(null);
    expect(isStructureOnly(CFG)).to.equal(false);
  });

  it("nor is it an UNANSWERED block — which is what the shipped template ships", () => {
    // `org-config.example.yaml` carries `authorized_agents:` with `default: ""` under it. Reading
    // that as "none" would turn every setup mid-flight into a considered choice to run no agents.
    const template = `${CFG}authorized_agents:\n  default: ""\n`;
    expect(readAuthorizedAgents(template).kind).to.equal("unset");
    expect(isStructureOnly(template), "an unanswered question is not a decision").to.equal(false);
  });

  it("replaces a real list with the decision, taking the old entries out with it", () => {
    const withList = withAuthorizedAgents(CFG, [{ id: "ibm-bob", default: true }, { id: "cursor" }])!;
    expect(readAuthorizedAgents(withList).kind).to.equal("agents");
    const off = withAuthorizedAgents(withList, [])!;
    expect(off).to.contain("authorized_agents: none");
    expect(off, "no orphaned entry left under a scalar").to.not.contain("ibm-bob");
    expect(off).to.not.contain("cursor");
    // …and back on again, which is the path an org takes when it starts using agents.
    const on = withAuthorizedAgents(off, [{ id: "claude-code", default: true }])!;
    expect(readAuthorizedAgents(on)).to.deep.equal({ kind: "agents", agents: [{ id: "claude-code", default: true }] });
  });

  it("survives an upgrade that re-introduces the template's `default:` line under the scalar", () => {
    // `mergeOrgConfig` walks the TEMPLATE's keys, so it can put `  default: ""` back beneath an
    // org's `authorized_agents: none`. The scalar still decides, and `default: none` reads the same.
    expect(readAuthorizedAgents(`${CFG}authorized_agents: none\n  default: ""\n`).kind).to.equal("none");
    expect(readAuthorizedAgents(`${CFG}authorized_agents:\n  default: "none"\n`).kind).to.equal("none");
  });

  it("returns null when the decision is already recorded — nothing would change", () => {
    const out = withAuthorizedAgents(CFG, [])!;
    expect(withAuthorizedAgents(out, [])).to.equal(null);
  });

  it("reads a hand-written single id on the key line rather than ignoring it", () => {
    // Not a shape gov writes. Reading it as "unset" would govern them by the whole framework list
    // without a word; a wrong id is reported by `gov agent`, which is where bad ids belong.
    expect(readAuthorizedAgents(`${CFG}authorized_agents: claude-code\n`))
      .to.deep.equal({ kind: "agents", agents: [{ id: "claude-code", default: true }] });
  });

  it("tolerates a trailing comment on the decision", () => {
    expect(isStructureOnly(`${CFG}authorized_agents: none   # ratified 2026-09-28, PR #31\n`)).to.equal(true);
  });
});

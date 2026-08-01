import { expect } from "chai";
import { matchesFilter } from "../src/store/store.js";
import { buildMetadata } from "../src/meta/metadata.js";
import type { ChunkMetadata } from "../src/types.js";
import { DOMAIN_OWNERS } from "../src/types.js";

function meta(over: Partial<ChunkMetadata>): ChunkMetadata {
  return {
    path: "knowledge/x.md", heading: "H", commitSha: "deadbee",
    domainOwner: "policy-owner", domain: "policies", layer: "mandate",
    compliance: "C01", status: "current", navFacets: { roleLenses: ["policy-owner"] },
    project: null, ...over,
  };
}

describe("MetadataFilter semantics (AND across fields, OR within)", () => {
  it("AND across fields", () => {
    const m = meta({ domain: "policies", layer: "mandate" });
    expect(matchesFilter(m, { domain: ["policies"], layer: ["mandate"] })).to.equal(true);
    expect(matchesFilter(m, { domain: ["policies"], layer: ["spec"] })).to.equal(false);
  });

  it("OR within a field", () => {
    const m = meta({ compliance: "C02" });
    expect(matchesFilter(m, { compliance: ["C01", "C02"] })).to.equal(true);
    expect(matchesFilter(m, { compliance: ["C03"] })).to.equal(false);
  });

  it("pathPrefix scoping", () => {
    const m = meta({ path: "knowledge/policies/roles.md" });
    expect(matchesFilter(m, { pathPrefix: ["knowledge/policies/"] })).to.equal(true);
    expect(matchesFilter(m, { pathPrefix: ["knowledge/legal/"] })).to.equal(false);
  });

  it("roleLens matches navFacets.roleLenses", () => {
    const m = meta({ navFacets: { roleLenses: ["development-owner"] } });
    expect(matchesFilter(m, { roleLens: ["development-owner"] })).to.equal(true);
    expect(matchesFilter(m, { roleLens: ["legal-owner"] })).to.equal(false);
  });

  it("PROOF: domainOwner=testing-quality-owner matches a real testing chunk", () => {
    // Synthesised authored testing doc — proves the owner-filter mechanism is
    // correct; the live corpus has no testing content yet (all empty README stubs).
    const fm = { domain: "testing", layer: "spec", owner: "testing-quality-owner", compliance: "C02", status: "current" };
    const m = buildMetadata("knowledge/testing/specs/coverage-gates.md", fm, "abc1234");
    expect(m.domainOwner).to.equal("testing-quality-owner");
    expect(matchesFilter(m, { domainOwner: ["testing-quality-owner"] })).to.equal(true);
    expect(matchesFilter(m, { domainOwner: ["deployment-release-owner"] })).to.equal(false);
  });
});

describe("metadata / domainOwner derivation", () => {
  it("maps compliance domain -> policy-owner (contract resolution)", () => {
    const m = buildMetadata("knowledge/compliance/README.md", { domain: "compliance", compliance: "evidence" }, "x");
    expect(m.domainOwner).to.equal("policy-owner");
  });

  it("derives owner from domain when front-matter owner is missing/invalid", () => {
    const m = buildMetadata("knowledge/deployment/specs/x.md", { domain: "deployment" }, "x");
    expect(m.domainOwner).to.equal("deployment-release-owner");
    expect(DOMAIN_OWNERS).to.include(m.domainOwner);
  });

  it("strips trailing inline comments from front-matter values", async () => {
    const { parseFrontMatter } = await import("../src/meta/frontmatter.js");
    const p = parseFrontMatter("---\ndomain: support            # one of the 9 domains\n---\n# T");
    expect(p.frontMatter.domain).to.equal("support");
  });
});

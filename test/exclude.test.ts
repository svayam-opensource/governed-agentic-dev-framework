import { expect } from "chai";
import { classifyExclusion } from "../src/chunk/exclude.js";

// C1 filter test — settles the index/journey-pollution include/exclude list.

describe("C1 exclusion (index / journey pollution)", () => {
  it("EXCLUDES journey/path docs (links-only, POL-410)", () => {
    const d = classifyExclusion("knowledge/paths/integrate-with-iam.md", { layer: "path" }, {}, "# Journey\n> Links only");
    expect(d.excluded).to.equal(true);
    expect(d.reason).to.equal("journey-path-doc");
  });

  it("EXCLUDES empty layer-index README stubs (the testing/ domain case)", () => {
    const body = "# testing — mandates\n\n## Index\n\n*(empty — add documents here per the KOS)*\n";
    const d = classifyExclusion("knowledge/testing/mandates/README.md", { domain: "testing", owner: "testing-quality-owner" }, {}, body);
    expect(d.excluded).to.equal(true);
    expect(d.reason).to.equal("readme-empty-index");
  });

  it("EXCLUDES dissolved / migration redirect README stubs", () => {
    const body = "# Dissolved (PRJ-005 knowledge migration)\n\n`patterns/` is no longer a top-level folder.";
    const d = classifyExclusion("knowledge/patterns/README.md", { status: "superseded" }, {}, body);
    expect(d.excluded).to.equal(true);
    expect(d.reason).to.equal("readme-dissolved");
  });

  it("KEEPS a README that carries authored prose (content-based, not blanket)", () => {
    const body = [
      "# Compliance",
      "",
      "This folder is part of the org-wide knowledge base. It records evidence and",
      "audit artifacts that demonstrate the organization meets its declared controls",
      "across every domain, and explains how to file a new piece of compliance evidence.",
    ].join("\n");
    const d = classifyExclusion("knowledge/compliance/README.md", { domain: "compliance" }, {}, body);
    expect(d.excluded).to.equal(false);
  });

  it("does NOT exclude a normal authored doc", () => {
    const d = classifyExclusion("knowledge/policies/llm-governance.md", { layer: "mandate" }, {}, "# LLM Governance\n## Purpose\nThis governs providers.");
    expect(d.excluded).to.equal(false);
  });

  it("includeIndexDocs=true disables all exclusion (benchmark variant a)", () => {
    const d = classifyExclusion("knowledge/paths/x.md", { layer: "path" }, { includeIndexDocs: true });
    expect(d.excluded).to.equal(false);
  });
});

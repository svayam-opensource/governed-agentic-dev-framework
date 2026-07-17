// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
import { expect } from "chai";
import { parseManifest, expandEntries, planUpgrade, mergeOrgConfig, applyUpgrade, formatPlan, type PlanReaders } from "../../src/maintain/upgrade-sync.js";

const MANIFEST = `
version: "1.0.0"
files:
  - { src: VERSION, dst: VERSION, mode: scaffold-auto }
  - { src: CLAUDE.md, dst: CLAUDE.md, mode: scaffold-prompt }
  - { src: knowledge/guidance/, dst: knowledge/guidance/, mode: scaffold-prompt }
  - { src: org-config.example.yaml, dst: org-config.yaml, mode: overlay-schema }
owned:
  - org-config.yaml
  - projects/PRJ-*/
`;

describe("gov-work — upgrade overlay-sync engine", () => {
  it("parses the MANIFEST (files + owned)", () => {
    const m = parseManifest(MANIFEST);
    expect(m.files).to.have.lengthOf(4);
    expect(m.files[0]).to.deep.equal({ src: "VERSION", dst: "VERSION", mode: "scaffold-auto" });
    expect(m.owned).to.include("org-config.yaml");
  });

  it("expands directory entries to per-file entries", () => {
    const m = parseManifest(MANIFEST);
    const exp = expandEntries(m, ["knowledge/guidance/a.md", "knowledge/guidance/sub/b.md", "other.md"]);
    const guidance = exp.filter((e) => e.dst.startsWith("knowledge/guidance/"));
    expect(guidance.map((e) => e.dst)).to.deep.equal(["knowledge/guidance/a.md", "knowledge/guidance/sub/b.md"]);
  });

  it("plans create / same / update / retire", () => {
    const content: Record<string, string> = { "VERSION": "1.0.0\n", "CLAUDE.md": "new claude\n", "org-config.example.yaml": 'org_name: ""\n' };
    const adopter: Record<string, string> = { "VERSION": "0.9.0\n", "CLAUDE.md": "new claude\n", "registry.yaml": "x", ".framework-version": "0.9.0", "framework/agent.md": "old" };
    const r: PlanReaders = {
      readContent: (p) => content[p] ?? null,
      readAdopter: (p) => adopter[p] ?? null,
      adopterPaths: () => Object.keys(adopter),
    };
    const m = parseManifest(MANIFEST);
    const plan = planUpgrade(expandEntries(m, []), r);
    const by = (k: string) => plan.actions.filter((a) => a.kind === k).map((a) => a.dst);
    expect(by("update")).to.include("VERSION");        // differs, scaffold-auto → overwrite
    expect(by("same")).to.include("CLAUDE.md");         // identical
    expect(by("create")).to.include("org-config.yaml"); // adopter has none → seed
    expect(by("retire")).to.have.members(["registry.yaml", ".framework-version", "framework/"]);
  });

  it("org-config overlay-schema: adds template keys, comments removed, keeps org values", () => {
    const template = 'org_name: ""\norg_short_name: ""\ndefault_branch: "main"\n';
    const org = 'org_name: "Acme"\ndefault_branch: "trunk"\nlegacy_field: "keep-as-comment"\n';
    const merged = mergeOrgConfig(template, org);
    expect(merged).to.match(/org_name: "Acme"/);          // value preserved
    expect(merged).to.match(/org_short_name: ""/);         // new key added from template
    expect(merged).to.match(/default_branch: "trunk"/);    // org value preserved (not template's "main")
    expect(merged).to.match(/# legacy_field: "keep-as-comment"/); // removed key commented
  });

  it("applyUpgrade writes creates/updates, merges overlay, removes retires; skips conflicts", () => {
    const content: Record<string, string> = { "VERSION": "1.0.0\n", "org-config.example.yaml": 'org_name: ""\nnew_key: ""\n' };
    const store: Record<string, string> = { "VERSION": "0.9.0\n", "org-config.yaml": 'org_name: "Acme"\n', "registry.yaml": "x" };
    const removed: string[] = [];
    const plan = planUpgrade(
      [{ src: "VERSION", dst: "VERSION", mode: "scaffold-auto" }, { src: "org-config.example.yaml", dst: "org-config.yaml", mode: "overlay-schema" }],
      { readContent: (p) => content[p] ?? null, readAdopter: (p) => store[p] ?? null, adopterPaths: () => Object.keys(store) },
    );
    const res = applyUpgrade(plan, {
      readContent: (p) => content[p] ?? null,
      readAdopter: (p) => store[p] ?? null,
      writeAdopter: (p, t) => { store[p] = t; },
      removeAdopter: (p) => { removed.push(p); },
    });
    expect(store["VERSION"]).to.equal("1.0.0\n");                 // updated
    expect(store["org-config.yaml"]).to.match(/org_name: "Acme"/); // value kept
    expect(store["org-config.yaml"]).to.match(/new_key: ""/);      // new key added
    expect(removed).to.include("registry.yaml");                   // retired
    expect(res.applied).to.include("VERSION");
    expect(formatPlan(plan).join("\n")).to.match(/plan:/);
  });
});

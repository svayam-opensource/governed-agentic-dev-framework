// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * POL-408 front matter for project knowledge — the check that did not exist.
 *
 * On 2026-08-07 a markdown formatter destroyed a knowledge doc's front matter (`domain: development` became
 * an `##` heading; the closing `---` vanished) and `gov validate` reported **PASS**. `checkKnowledge` covers
 * the org tree, `knowledge/**`; nothing covered `projects/<id>/knowledge/**`, where every doc written during
 * this project lives. The requirement had been resting on care, not enforcement.
 */
import { expect } from "chai";
import { checkProjectKnowledge, pol408Errors, isProjectDoc } from "../../src/governance/project-knowledge.js";
import type { ValidateContext } from "../../src/governance/validate.js";

const VALID = `---
domain: deployment
layer: spec
owner: deployment-release-owner
compliance: descriptive
status: current
---

# A doc
`;

/** exactly what the formatter produced: the opening fence survives, the closing one does not. */
const FORMATTER_DAMAGED = `---

## domain: development

layer: spec
owner: system-architecture-owner
compliance: descriptive
status: draft

# Vocabulary
`;

const ctx = (files: Record<string, string>, changedFiles?: string[]): ValidateContext => ({
  repoRoot: "/r",
  fs: { readFile: (p: string) => files[p.replace("/r/", "")] ?? null, pathExists: () => true } as unknown as ValidateContext["fs"],
  ...(changedFiles ? { changedFiles } : {}),
});

describe("POL-408 — project knowledge front matter", () => {
  const DOC = "projects/PRJ-43-gov/knowledge/vocabulary.md";

  it("catches the damage that passed: a front-matter block with no closing fence", () => {
    const errs = pol408Errors(DOC, FORMATTER_DAMAGED);
    expect(errs, "this exact text passed `gov validate` on 2026-08-07").to.have.length(1);
    expect(errs[0]).to.match(/missing or unparseable front-matter/);
  });

  it("a valid doc has nothing to say about it", () => {
    expect(pol408Errors(DOC, VALID)).to.deep.equal([]);
  });

  it("names the offending field AND the allowed values — a taxonomy error you cannot fix is a wall", () => {
    const bad = VALID.replace("status: current", "status: accepted").replace("domain: deployment", "domain: architecture");
    const errs = pol408Errors(DOC, bad).join(" ");
    expect(errs, "`status: accepted` is what two ADRs in this repo actually said").to.match(/status='accepted' invalid/);
    expect(errs, "`domain: architecture` — the taxonomy has architecture/system and architecture/data").to.match(/domain='architecture' invalid/);
    expect(errs, "the fix must be in the message").to.contain("architecture/system");
    expect(errs).to.contain("superseded");
  });

  it("a missing owner is an error — every doc has someone answerable for it", () => {
    expect(pol408Errors(DOC, VALID.replace("owner: deployment-release-owner\n", "")).join(" ")).to.match(/owner missing/);
  });

  // THE SCOPE RULE. 221 project docs exist and 16 are compliant; validating all of them would fail every
  // push in the repo, and a check nobody can satisfy gets switched off. Enforce on what you TOUCHED.
  describe("scope", () => {
    it("enforces on a changed doc", () => {
      const r = checkProjectKnowledge(ctx({ [DOC]: FORMATTER_DAMAGED }, [DOC]));
      expect(r.ok).to.equal(false);
      expect(r.errors[0]).to.contain(DOC);
    });

    it("ignores an untouched doc, however broken", () => {
      const other = "projects/PRJ-005-old/knowledge/legacy.md";
      const r = checkProjectKnowledge(ctx({ [DOC]: VALID, [other]: "no front matter at all" }, [DOC]));
      expect(r.ok, "history is not this change's problem").to.equal(true);
    });

    // A validator that invents a scope makes its verdict depend on where it ran — passing in CI and failing
    // locally, or the reverse. Absent scope means "nothing declared", never "everything".
    it("passes silently when no scope is declared — it does not guess", () => {
      expect(checkProjectKnowledge(ctx({ [DOC]: FORMATTER_DAMAGED })).ok).to.equal(true);
    });

    it("a deleted doc is not a violation", () => {
      expect(checkProjectKnowledge(ctx({}, ["projects/PRJ-43-gov/knowledge/gone.md"])).ok).to.equal(true);
    });
  });

  describe("what it governs", () => {
    it("project knowledge, not the org tree and not code", () => {
      expect(isProjectDoc("projects/PRJ-43-gov/knowledge/adr-x.md")).to.equal(true);
      expect(isProjectDoc("projects/PRJ-43-gov/knowledge/units/gov-work/SDD.md")).to.equal(true);
      expect(isProjectDoc("knowledge/policies/agentic-development-policy.md"), "the org tree is checkKnowledge's").to.equal(false);
      expect(isProjectDoc("projects/PRJ-43-gov/project.yaml")).to.equal(false);
      expect(isProjectDoc("src/cli/main.ts")).to.equal(false);
    });

    // Working files, not knowledge artifacts: the carry-forward list, the compliance ledger, the handoff.
    // They are read constantly and would otherwise have to carry a taxonomy that says nothing about them.
    it("exempts todo.md, compliance.md, HANDOFF.md and templates", () => {
      for (const f of ["todo.md", "compliance.md", "HANDOFF.md", "TEMPLATE.md", "adr-template.md"]) {
        expect(isProjectDoc(`projects/PRJ-43-gov/knowledge/${f}`), f).to.equal(false);
      }
      expect(isProjectDoc("projects/PRJ-43-gov/knowledge/templates/thing.md")).to.equal(false);
    });
  });
});

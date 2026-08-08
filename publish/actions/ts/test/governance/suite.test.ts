// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
import { expect } from "chai";
import { runSuite, CORE_VALIDATORS } from "../../src/governance/suite.js";
import { runValidators, type Validator, type ValidateContext } from "../../src/governance/validate.js";
import type { Fs } from "../../src/lifecycle/fs-io.js";

const noFs: Fs = {
  pathExists: () => false,
  readFile: () => null,
  mkdirp: () => {},
  writeFile: () => {},
  rm: () => {},
  readdir: () => [],
};
const ctx: ValidateContext = { fs: noFs, repoRoot: "/repo", files: [] };

describe("prj-work Phase 3 — validate suite", () => {
  it("CORE_VALIDATORS is the 5 test-merge checks (privacy is publish-only)", () => {
    // 5 since 2026-08-07: project-knowledge joined — POL-408 front matter for projects/<id>/knowledge/**,
    // which nothing validated until a formatter broke a doc and `gov validate` said PASS.
    expect(CORE_VALIDATORS).to.have.lengthOf(5);
  });

  it("runSuite returns a close-gate-compatible { ok, failures }", () => {
    const pass: Validator = () => ({ name: "x", ok: true, errors: [] });
    expect(runSuite(ctx, [pass])).to.deep.equal({ ok: true, failures: [] });

    const fail: Validator = () => ({ name: "y", ok: false, errors: ["boom"] });
    const r = runSuite(ctx, [pass, fail]);
    expect(r.ok).to.equal(false);
    expect(r.failures).to.deep.equal(["y: boom"]);
  });

  it("runValidators aggregates results across the core suite (no throw on a bare repo)", () => {
    const run = runValidators(ctx, CORE_VALIDATORS);
    // A bare/empty repo fails several checks, but the run completes and aggregates.
    expect(run.results).to.have.lengthOf(5);
    expect(run.ok).to.equal(false);
  });
});

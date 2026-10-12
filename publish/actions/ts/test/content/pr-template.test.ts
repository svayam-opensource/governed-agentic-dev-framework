// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * THE SEEDED PULL REQUEST TEMPLATE CARRIES A `## Deviations` SECTION (PRJ-121 intent 01 §3.4, S3).
 *
 * compliance.md is retired. A C03 deviation is recorded where it is reviewed: in the pull request that takes it, one
 * line per deviation, citing the GOV id of the rule deviated from and why. The template asks for exactly that.
 */
import { expect } from "chai";
import * as fs from "node:fs";
import * as path from "node:path";

const CONTENT = path.join(import.meta.dirname, "..", "..", "..", "..", "content");
const TEMPLATE = path.join(CONTENT, ".github", "pull_request_template.md");

describe("the seeded pull request template — deviations are recorded in the pull request", () => {
  const text = fs.readFileSync(TEMPLATE, "utf8");
  const section = (): string => {
    const at = text.search(/^## Deviations\s*$/m);
    const rest = text.slice(at + 1);
    const next = rest.search(/^## /m);
    return next === -1 ? rest : rest.slice(0, next);
  };

  it("has a `## Deviations` heading", () => {
    expect(text).to.match(/^## Deviations\s*$/m);
  });

  it("asks for one line per C03 deviation, citing its GOV id", () => {
    const s = section();
    expect(s).to.match(/C03/);
    expect(s).to.match(/one line/i);
    expect(s).to.match(/GOV-[A-Z]+-\d+|GOV id/);
  });

  it("no longer points at compliance.md", () => {
    expect(text).to.not.contain("compliance.md");
  });
});

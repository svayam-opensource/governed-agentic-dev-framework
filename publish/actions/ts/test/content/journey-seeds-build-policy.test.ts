// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
//
// PRJ-121 intent 01 (L02b) REGRESSION — run 38386806174: the rule-model journey edited `policies/build/policy.md`, which
// nothing had created. The starter is `seed-new` (spec §3.2): `gov setup` makes it for a NEW org and `gov upgrade`
// never does, and the journey configures an existing repo in place. So the journey must seed the file itself, BEFORE
// the first step that edits or cites it, or `git commit -a` finds nothing to commit and the run dies there.
import { expect } from "chai";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const JOURNEY = fileURLToPath(new URL("../../e2e/rule-model-journey.sh", import.meta.url));

describe("the rule-model journey seeds the seed-new build policy before it edits it (L02b, run 38386806174)", () => {
  const lines = fs.readFileSync(JOURNEY, "utf8").split("\n");
  const seed = lines.findIndex((l) => /\bcp "\$CONTENT_DIR\/policies\/build\/policy\.md" "\$G\/policies\/build\/policy\.md"/.test(l));
  const firstEdit = lines.findIndex((l, i) => i > seed && /perl .*-0pi .*"\$G\/policies\/build\/policy\.md"/.test(l));

  it("has a step that writes policies/build/policy.md from the shipped content", () => {
    expect(seed, "no line creates $G/policies/build/policy.md").to.be.greaterThan(-1);
    expect(lines[seed]).to.contain("$CONTENT_DIR/policies/build/policy.md");
  });

  it("does so before the first edit of it, and before the step that commits everything", () => {
    expect(firstEdit, "the journey no longer edits §2.2 — update this test").to.be.greaterThan(-1);
    expect(seed).to.be.lessThan(firstEdit);
    const addAll = lines.findIndex((l) => /git -C "\$G" add -A && .*commit -qm "gov setup \+ upgrade/.test(l));
    expect(seed).to.be.lessThan(addAll);
  });

  it("the shipped starter still holds the sentence the journey rewrites (§2.2 'unless an exception is\\napproved.')", () => {
    const starter = fs.readFileSync(path.join(path.dirname(JOURNEY), "..", "..", "..", "content", "policies", "build", "policy.md"), "utf8");
    expect(starter).to.contain("unless an exception is\napproved.");
  });
});

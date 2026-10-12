// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * M6a/b — `gov rules propose` (and the policy gate, which shares the definition) reads `policies/active/`, never
 * `policies/reference/`: the reference library is templates, and a template is never turned into rules.
 */
import { expect } from "chai";
import { policyDocPaths } from "../../src/rules/policy-pr/gate.js";
import { memTree } from "../../src/rules/policy-pr/tree.js";

describe("rules propose — active lifecycle only", () => {
  const tree = memTree({
    "policies/org-policy.md": "## 1 A\n",
    "policies/active/ai-sdlc-lifecycle.md": "## 3. Intent (phase: build)\n",
    "policies/reference/lifecycles/ai-sdlc/spec.md": "## Design\n",
    "policies/reference/README.md": "# library\n",
  });

  it("reads policies/active/", () => {
    expect(policyDocPaths(tree)).to.include("policies/active/ai-sdlc-lifecycle.md");
  });

  it("never reads policies/reference/", () => {
    expect(policyDocPaths(tree)!.filter((d) => d.startsWith("policies/reference/"))).to.deep.equal([]);
  });
});

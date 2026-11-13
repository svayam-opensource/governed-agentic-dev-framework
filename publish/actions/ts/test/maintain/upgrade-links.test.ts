// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
//
// F55 (Policy Owner ruling A, 2026-11-12): the 1.0 → 2.0 upgrade left the org's kept READMEs linking to files it
// moved, migrated or retired, so the upgraded tree failed `gov validate` (16 broken links on a real org). The bridge
// now repoints them: commit 3 for what commits 1–3 remove, commit 4 for what its droppable proposal retires.
import { expect } from "chai";
import { upgradeRelinks, relinkPlan } from "../../src/maintain/upgrade-links.js";
import type { PlanAction } from "../../src/maintain/upgrade-sync.js";

const FILES: Record<string, string> = {
  "knowledge/policies/README.md": [
    "- [roles](roles.md) and [data](data-classification.md#levels)",
    "- [llm](./llm-governance.md \"LLM\")",
    "- [site](https://example.com/roles.md), [here](#top), [kept](kept.md), [missing](never-there.md)",
    "- ![diagram](roles.md)",
  ].join("\n"),
  "knowledge/policies/exceptions/README.md": "[t](./legal/TEMPLATE.md) [r](./legal/2026-01-01-X.md)",
  "knowledge/policies/procedures/README.md": "[templates](./templates/) and [x](./templates/compliance-template.md)",
  "knowledge/policies/roles.md": "r",
  "knowledge/policies/data-classification.md": "d",
  "knowledge/policies/llm-governance.md": "l",
  "knowledge/policies/kept.md": "k",
  "knowledge/policies/exceptions/legal/TEMPLATE.md": "t",
  "knowledge/policies/exceptions/legal/2026-01-01-X.md": "x",
  "knowledge/policies/procedures/templates/compliance-template.md": "c",
  "knowledge/policies/procedures/templates/todo-template.md": "t",
  "knowledge/policies/agentic-development-policy.md": "p",
  "knowledge/README.md": "[policy](./policies/agentic-development-policy.md)",
};
const files = Object.keys(FILES);
const read = (p: string): string | null => FILES[p] ?? null;

const ACTIONS: PlanAction[] = [
  { kind: "migrate", from: "knowledge/policies/roles.md", dst: "policies/common/authorized-representatives.md" },
  { kind: "move", from: "knowledge/policies/data-classification.md", dst: "policies/common/data-classification.md" },
  { kind: "migrate", from: "knowledge/policies/llm-governance.md", dst: "policies/governance.yaml" },
  { kind: "retire", dst: "knowledge/policies/exceptions/legal/TEMPLATE.md" },
  { kind: "move", from: "knowledge/policies/exceptions/legal/2026-01-01-X.md", dst: "policies/exceptions/legal/2026-01-01-X.md" },
  { kind: "retire", dst: "knowledge/policies/procedures/templates/compliance-template.md" },
  { kind: "retire", dst: "knowledge/policies/procedures/templates/todo-template.md" },
  { kind: "create", dst: "framework/common/templates/exception-template.md" },
  { kind: "create", dst: "framework/build/templates/todo-template.md" },
  { kind: "migrate", from: "org-config.yaml", dst: "policies/governance.yaml" },
  { kind: "retire", dst: "knowledge/policies/agentic-development-policy.md", commit: "proposed-prose" },
];
const textOf = (acts: readonly PlanAction[], f: string) => acts.find((a) => a.dst === f)?.text;

describe("gov upgrade bridge — links repointed (F55)", () => {
  const first = relinkPlan(files, read, ACTIONS.filter((a) => a.commit !== "proposed-prose")).actions;

  it("moved and migrated targets → their new homes, relative; anchors and titles kept", () => {
    const t = textOf(first, "knowledge/policies/README.md")!;
    expect(t).to.include("[roles](../../policies/common/authorized-representatives.md)");
    expect(t).to.include("[data](../../policies/common/data-classification.md#levels)");
    expect(t).to.include("[llm](../../policies/governance.yaml \"LLM\")");
    expect(t).to.include("![diagram](../../policies/common/authorized-representatives.md)");
  });

  it("leaves external links, anchors, kept files and already-missing targets alone", () => {
    const t = textOf(first, "knowledge/policies/README.md")!;
    expect(t).to.include("[site](https://example.com/roles.md), [here](#top), [kept](kept.md), [missing](never-there.md)");
  });

  it("a retired file with a 2.0 successor → the successor; with none → the link text only", () => {
    expect(textOf(first, "knowledge/policies/exceptions/README.md"))
      .to.equal("[t](../../../framework/common/templates/exception-template.md) [r](../../../policies/exceptions/legal/2026-01-01-X.md)");
    expect(textOf(first, "knowledge/policies/procedures/README.md"))
      .to.equal("[templates](../../../framework/build/templates/) and x");
  });

  it("only link targets change, and every action lands in commit 3", () => {
    expect(first.every((a) => a.kind === "relink" && a.commit === "migrations")).to.equal(true);
    expect(first.map((a) => a.dst)).to.not.include("knowledge/README.md", "commit 4's retirement is not commit 3's");
  });

  it("org-config.yaml stays after its migration: a link to it is not touched", () => {
    const r = relinkPlan(["docs/x.md", "org-config.yaml"], (p) => (p === "docs/x.md" ? "[c](../org-config.yaml)" : "k: v"), ACTIONS);
    expect(r.actions).to.deep.equal([]);
  });

  it("commit 4's retirement is repointed in commit 4, over commit 3's text — dropping it leaves the link", () => {
    const all = upgradeRelinks(files, read, ACTIONS);
    const fourth = all.filter((a) => a.commit === "proposed-prose");
    expect(fourth.map((a) => a.dst)).to.deep.equal(["knowledge/README.md"]);
    expect(textOf(fourth, "knowledge/README.md")).to.equal("policy");
    expect(all.filter((a) => a.commit === "migrations")).to.deep.equal(first);
  });
});

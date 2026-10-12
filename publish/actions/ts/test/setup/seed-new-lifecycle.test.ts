// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * Spec 03 D1 — a fresh `gov setup` seeds the starter lifecycle (1 policy + 6 templates) as `seed-new`; `gov upgrade`
 * never re-seeds it: an organization that adopted before it shipped is not handed it, one that changed it keeps its copy.
 */
import { expect } from "chai";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { parseManifest } from "../../src/maintain/upgrade-sync.js";
import { runUpgradeSync } from "../../src/maintain/upgrade-run.js";

const CONTENT = path.join(import.meta.dirname, "..", "..", "..", "..", "content");
const LIFECYCLE = [
  "policies/active/ai-sdlc-lifecycle.md",
  ...["intent", "spec", "plan", "build", "deploy", "run"].map((s) => `policies/reference/lifecycles/ai-sdlc/${s}.md`),
];
const tmp = (): string => fs.mkdtempSync(path.join(os.tmpdir(), "seed-new-lifecycle-"));
const exists = (d: string, rel: string): boolean => fs.existsSync(path.join(d, rel));

describe("starter lifecycle — seed-new (spec 03 D1)", () => {
  it("the MANIFEST ships the 7 lifecycle files as seed-new, src = dst", () => {
    const m = parseManifest(fs.readFileSync(path.join(CONTENT, "MANIFEST.yaml"), "utf8"));
    for (const f of LIFECYCLE) {
      const row = m.files.find((r) => r.dst === f);
      expect(row, f).to.not.equal(undefined);
      expect(row!.mode, f).to.equal("seed-new");
      expect(row!.src, f).to.equal(f);
    }
  });

  it("a fresh setup seeds all 7 files", () => {
    const a = tmp();
    const r = runUpgradeSync(CONTENT, a, { apply: true, seed: true });
    expect(r.code, r.lines.join("\n")).to.equal(0);
    for (const f of LIFECYCLE) expect(exists(a, f), f).to.equal(true);
  });

  it("gov upgrade never seeds them into an org that adopted without them", () => {
    const a = tmp();
    runUpgradeSync(CONTENT, a, { apply: true, seed: true });
    for (const f of LIFECYCLE) fs.rmSync(path.join(a, f));
    fs.writeFileSync(path.join(a, "VERSION"), "0.0.1\n");
    runUpgradeSync(CONTENT, a, { apply: true });
    for (const f of LIFECYCLE) expect(exists(a, f), f).to.equal(false);
  });

  it("gov upgrade never touches an org's edited copy", () => {
    const a = tmp();
    runUpgradeSync(CONTENT, a, { apply: true, seed: true });
    const ours = "# Our lifecycle\n";
    fs.writeFileSync(path.join(a, LIFECYCLE[0]), ours);
    fs.writeFileSync(path.join(a, "VERSION"), "0.0.1\n");
    runUpgradeSync(CONTENT, a, { apply: true });
    expect(fs.readFileSync(path.join(a, LIFECYCLE[0]), "utf8")).to.equal(ours);
  });
});

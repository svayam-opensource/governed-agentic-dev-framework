// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * install.sh's itinerary and gov's checklist are the same list (#186).
 *
 * They have to be written twice: the itinerary is printed before Node exists, so it
 * cannot come from TypeScript, and the checklist is derived from the machine, so it
 * cannot come from bash. Two copies of one fact, with nothing comparing them, is the
 * shape behind most of this project's defects — registry.yaml against GitHub,
 * ~/.<slug> against ~/.gov/<slug>, ADOPTER_DIRS against MANIFEST.yaml, package.json
 * against content/VERSION. Every one of them drifted, and every one was found by a
 * person rather than a test.
 *
 * So this is the thing that compares them. The TypeScript list is the source of
 * truth; the itinerary must agree with it, step for step.
 */
import { expect } from "chai";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { checklist } from "../../src/cli/checklist.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../..");
const INSTALL_SH = path.join(repoRoot, "install.sh");

/** The `say "   N. [ ] text"` lines install.sh prints as its plan. */
function itinerary(): readonly { readonly n: string; readonly text: string }[] {
  const text = fs.readFileSync(INSTALL_SH, "utf8");
  const out: { n: string; text: string }[] = [];
  for (const m of text.matchAll(/say\s+"\s*(\d+)\.\s*\[ \]\s*([^"]+)"/g)) {
    // Strip the shell colour variables the line carries for the terminal.
    const cleaned = m[2]!.replace(/\$\{[A-Z]+\}/g, "").replace(/\s+/g, " ").trim();
    out.push({ n: m[1]!, text: cleaned });
  }
  return out;
}

/** The top-level steps gov derives, with the same cleaning applied. */
function govSteps(): readonly { readonly n: string; readonly text: string }[] {
  return checklist({
    gitPresent: false, ghPresent: false, ghAuthenticated: false, ghScopesOk: false,
    gitIdentityOk: false, workspaceResolves: false, orgActive: null,
    workspacePath: null, orgSlug: null, role: "adopter",
  })
    .filter((i) => !i.sub)
    // The itinerary carries no live values — it is printed before any exist — so
    // compare only the part that cannot vary.
    .map((i) => ({ n: i.n, text: i.text.replace(/\s+\(.*$/, "").replace(/\s+at\s+.*$/, "").replace(/\s+—\s+<.*$/, "").trim() }));
}

describe("gov-work — install.sh's itinerary matches gov's checklist (#186)", () => {
  it("install.sh actually prints an itinerary", () => {
    expect(itinerary(), "the plan disappeared from install.sh").to.have.length.greaterThan(5);
  });

  it("the same steps, in the same order, under the same numbers", () => {
    const sh = itinerary();
    const ts = govSteps();
    expect(sh.map((i) => i.n), "numbering").to.deep.equal(ts.map((i) => i.n));
  });

  it("and the same words — a step renamed on one side must be renamed on both", () => {
    const sh = itinerary();
    const ts = govSteps();
    for (const [i, step] of ts.entries()) {
      const said = sh[i]?.text ?? "";
      // Not equality: the itinerary may say less, because it is printed before the
      // machine is known. It may not say something DIFFERENT.
      expect(
        said.startsWith(step.text) || step.text.startsWith(said),
        `step ${step.n}: install.sh says "${said}", gov says "${step.text}"`,
      ).to.equal(true);
    }
  });
});

// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * `seed-new` (PRJ-121 intent 01, spec §3.2): a starter `gov setup` creates for a NEW organization and `gov upgrade`
 * never plans — not create, not update, not conflict. An organization that adopted before the starter shipped is
 * not handed it by an upgrade; one that has it keeps its copy untouched.
 */
import { expect } from "chai";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { parseManifest, expandEntries, planUpgrade, formatPlan, KNOWN_MODES, type PlanReaders } from "../../src/maintain/upgrade-sync.js";
import { runUpgradeSync } from "../../src/maintain/upgrade-run.js";

const MANIFEST = `
version: "2.0.0"
files:
  - { src: VERSION, dst: VERSION, mode: scaffold-auto }
  - { src: policies/build/policy.md, dst: policies/build/policy.md, mode: seed-new }
  - { src: policies/org-policy.md, dst: policies/org-policy.md, mode: seed-once }
`;
const STARTER = "# Build policy\n\nThe starter.\n";

function contentDir(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "seed-new-content-"));
  const put = (rel: string, text: string): void => { fs.mkdirSync(path.dirname(path.join(d, rel)), { recursive: true }); fs.writeFileSync(path.join(d, rel), text); };
  put("MANIFEST.yaml", MANIFEST);
  put("VERSION", "2.0.0\n");
  put("policies/build/policy.md", STARTER);
  put("policies/org-policy.md", "# Org policy\n");
  return d;
}
function adopterDir(files: Record<string, string> = {}): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "seed-new-adopter-"));
  for (const [rel, text] of Object.entries(files)) { fs.mkdirSync(path.dirname(path.join(d, rel)), { recursive: true }); fs.writeFileSync(path.join(d, rel), text); }
  return d;
}
const read = (d: string, rel: string): string | null => (fs.existsSync(path.join(d, rel)) ? fs.readFileSync(path.join(d, rel), "utf8") : null);

describe("seed-new — a starter for new organizations only (spec §3.2)", () => {
  it("is a mode this engine knows, and the parser keeps it", () => {
    expect(KNOWN_MODES).to.include("seed-new");
    expect(parseManifest(MANIFEST).files.find((f) => f.dst === "policies/build/policy.md")?.mode).to.equal("seed-new");
  });

  it("setup's seed creates a seed-new file", () => {
    const c = contentDir(), a = adopterDir();
    const r = runUpgradeSync(c, a, { apply: true, seed: true });
    expect(r.code).to.equal(0);
    expect(read(a, "policies/build/policy.md")).to.equal(STARTER);
  });

  it("an upgrade on a repo without it plans nothing for it — no create, update or conflict — and writes nothing", () => {
    const c = contentDir(), a = adopterDir({ "VERSION": "1.9.0\n", "policies/org-policy.md": "# Ours\n" });
    const m = parseManifest(MANIFEST);
    const entries = expandEntries(m, ["VERSION", "policies/build/policy.md", "policies/org-policy.md"]);
    const readers: PlanReaders = {
      readContent: (rel) => read(c, rel),
      readAdopter: (rel) => read(a, rel),
      adopterPaths: () => ["VERSION", "policies/org-policy.md"],
    };
    const plan = planUpgrade(entries, readers);
    const forIt = plan.actions.filter((x) => x.dst === "policies/build/policy.md");
    expect(forIt.map((x) => x.kind)).to.not.include.members(["create", "update", "conflict", "refuse", "keep"]);
    expect(forIt.every((x) => x.kind === "starter")).to.equal(true);
    const r = runUpgradeSync(c, a, { apply: true });
    expect(r.code).to.equal(0);
    expect(read(a, "policies/build/policy.md")).to.equal(null);
  });

  it("an upgrade never touches an existing copy", () => {
    const ours = "# Our build policy — rewritten\n";
    const c = contentDir(), a = adopterDir({ "VERSION": "1.9.0\n", "policies/build/policy.md": ours, "policies/org-policy.md": "# Ours\n" });
    const dry = runUpgradeSync(c, a, { apply: false });
    expect(dry.lines.join("\n")).to.not.match(/(create|update|review|keep)\s+policies\/build\/policy\.md/);
    runUpgradeSync(c, a, { apply: true });
    expect(read(a, "policies/build/policy.md")).to.equal(ours);
  });

  it("the dry run lists a missing starter as \"starter for new orgs\"", () => {
    const c = contentDir(), a = adopterDir({ "VERSION": "1.9.0\n", "policies/org-policy.md": "# Ours\n" });
    const r = runUpgradeSync(c, a, { apply: false });
    const line = r.lines.find((l) => l.includes("policies/build/policy.md"));
    expect(line, r.lines.join("\n")).to.match(/starter for new orgs/);
    expect(formatPlan({ actions: [{ kind: "starter", dst: "x.md", src: "x.md" }] }).join("\n")).to.match(/starter for new orgs/);
  });
});

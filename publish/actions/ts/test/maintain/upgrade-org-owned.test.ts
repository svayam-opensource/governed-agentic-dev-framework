// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * GOV-FRM-445 — THE ORG'S OWN FILES ARE NEVER OVERWRITTEN BY TEMPLATE BYTES, WHATEVER THE MANIFEST SAYS.
 *
 * An adoption walk (svm-geneva, Rocky 9, 2026-10-07) ran a gov built from a feature branch against content fetched
 * from `main`. main's MANIFEST still marked org-config.yaml `overlay-schema` — a mode this engine no longer knows —
 * which fell through to "conflict", which `--pr` applies. The org's filled org-config.yaml was replaced with the
 * blank template: `org_name: "Geneva ERS"` became `""`. The engine now decides org ownership itself.
 */
import { expect } from "chai";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import { parseManifest, expandEntries, planUpgrade, applyUpgrade, formatPlan, type PlanReaders } from "../../src/maintain/upgrade-sync.js";
import { runUpgradeSync, runUpgradePr } from "../../src/maintain/upgrade-run.js";

const FILLED = 'org_name: "Geneva ERS"\ngithub_org: "svm-geneva"\norg_slug: "GEN"\n';
const TEMPLATE = 'org_name: ""\ngithub_org: ""\norg_slug: ""\n';

function plan(manifest: string, content: Record<string, string>, adopter: Record<string, string>) {
  const r: PlanReaders = { readContent: (p) => content[p] ?? null, readAdopter: (p) => adopter[p] ?? null, adopterPaths: () => Object.keys(adopter) };
  const m = parseManifest(manifest);
  return planUpgrade(expandEntries(m, Object.keys(content)), r, m.moves, m.retire, m.owned);
}

function applyAll(p: ReturnType<typeof planUpgrade>, content: Record<string, string>, store: Record<string, string>): void {
  applyUpgrade(p, {
    readContent: (q) => content[q] ?? null,
    readAdopter: (q) => store[q] ?? null,
    writeAdopter: (q, t) => { store[q] = t; },
    removeAdopter: (q) => { delete store[q]; },
  }, { includeConflicts: true });   // the --pr path: everything planned is applied
}

describe("GOV-FRM-445 — org-owned files are never overwritten by an upgrade", () => {
  for (const mode of ["overlay-schema", "scaffold-auto", "scaffold-prompt"]) {
    it(`GOV-FRM-445: a filled org-config.yaml + an old manifest marking it ${mode} → the file is unchanged`, () => {
      const manifest = `files:\n  - { src: org-config.example.yaml, dst: org-config.yaml, mode: ${mode} }\n`;
      const content = { "org-config.example.yaml": TEMPLATE };
      const store: Record<string, string> = { "org-config.yaml": FILLED };
      const p = plan(manifest, content, store);
      applyAll(p, content, store);
      expect(store["org-config.yaml"]).to.equal(FILLED);
      // …and the plan SAYS it ignored the manifest's mode, rather than skipping silently.
      expect(formatPlan(p).join("\n")).to.match(new RegExp(`org-config\\.yaml.*org-owned.*manifest.*${mode}`));
    });
  }

  it("GOV-FRM-445: an org-edited policies/ file the manifest marks scaffold-auto → unchanged", () => {
    const manifest = "files:\n  - { src: policies/, dst: policies/, mode: scaffold-auto }\n";
    const content = { "policies/org-policy.md": "# template\n", "policies/new.md": "# new\n" };
    const store: Record<string, string> = { "policies/org-policy.md": "# Geneva's policy\n" };
    const p = plan(manifest, content, store);
    applyAll(p, content, store);
    expect(store["policies/org-policy.md"]).to.equal("# Geneva's policy\n");
    expect(store["policies/new.md"], "a policy file the org does not have yet is still seeded").to.equal("# new\n");
  });

  it("GOV-FRM-445: a path the manifest's own owned: list names is the org's too", () => {
    const manifest = "files:\n  - { src: CODEOWNERS, dst: CODEOWNERS, mode: scaffold-auto }\nowned:\n  - CODEOWNERS\n";
    const store: Record<string, string> = { CODEOWNERS: "* @geneva\n" };
    const p = plan(manifest, { CODEOWNERS: "* @template\n" }, store);
    applyAll(p, { CODEOWNERS: "* @template\n" }, store);
    expect(store.CODEOWNERS).to.equal("* @geneva\n");
  });

  it("GOV-FRM-445: org-config.yaml absent → still seeded from the template", () => {
    const manifest = "files:\n  - { src: org-config.example.yaml, dst: org-config.yaml, mode: scaffold-auto }\n";
    const store: Record<string, string> = {};
    const p = plan(manifest, { "org-config.example.yaml": TEMPLATE }, store);
    applyAll(p, { "org-config.example.yaml": TEMPLATE }, store);
    expect(store["org-config.yaml"]).to.equal(TEMPLATE);
  });

  it("GOV-FRM-445: a manifest that retires org-config.yaml is ignored — the org's file stays", () => {
    const manifest = "files:\n  - { src: VERSION, dst: VERSION, mode: scaffold-auto }\nretire:\n  - org-config.yaml\n";
    const store: Record<string, string> = { "org-config.yaml": FILLED };
    const p = plan(manifest, { VERSION: "1\n" }, store);
    applyAll(p, { VERSION: "1\n" }, store);
    expect(store["org-config.yaml"]).to.equal(FILLED);
  });

  it("GOV-FRM-445: a mode this gov does not know is left alone, and said — never treated as a conflict to apply", () => {
    const manifest = "files:\n  - { src: README.md, dst: README.md, mode: overlay-schema }\n";
    const store: Record<string, string> = { "README.md": "ours\n" };
    const p = plan(manifest, { "README.md": "theirs\n" }, store);
    applyAll(p, { "README.md": "theirs\n" }, store);
    expect(store["README.md"]).to.equal("ours\n");
    expect(formatPlan(p).join("\n")).to.match(/README\.md.*does not know.*overlay-schema/);
  });

  describe("through the runner (real files)", () => {
    const tmp = (p: string): string => fs.mkdtempSync(path.join(os.tmpdir(), p));
    const write = (root: string, rel: string, text: string): void => { fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true }); fs.writeFileSync(path.join(root, rel), text); };
    const oldContent = (): string => {
      const c = tmp("gov445-content-");
      write(c, "MANIFEST.yaml", "version: \"1.2.3\"\nfiles:\n  - { src: VERSION, dst: VERSION, mode: scaffold-auto }\n  - { src: org-config.example.yaml, dst: org-config.yaml, mode: overlay-schema }\nowned:\n  - org-config.yaml\n");
      write(c, "VERSION", "1.2.3\n");
      write(c, "org-config.example.yaml", TEMPLATE);
      return c;
    };

    it("GOV-FRM-445: gov upgrade --apply with an old-style manifest leaves the filled org-config.yaml byte for byte", () => {
      const adopter = tmp("gov445-adopter-");
      write(adopter, "org-config.yaml", FILLED);
      const r = runUpgradeSync(oldContent(), adopter, { apply: true, userHome: tmp("gov445-home-") });
      expect(r.code, r.lines.join("\n")).to.equal(0);
      expect(fs.readFileSync(path.join(adopter, "org-config.yaml"), "utf8")).to.equal(FILLED);
    });

    const gitOk = (): boolean => { try { execFileSync("git", ["--version"], { stdio: "ignore" }); return true; } catch { return false; } };
    (gitOk() ? it : it.skip)("GOV-FRM-445: gov upgrade --pr (applies conflicts) with an old-style manifest leaves org-config.yaml unchanged on the PR branch", () => {
      const adopter = tmp("gov445-pr-");
      const g = (...a: string[]): string => execFileSync("git", ["-C", adopter, ...a], { encoding: "utf8" });
      g("init", "-q", "-b", "main"); g("config", "user.email", "t@example.com"); g("config", "user.name", "t");
      write(adopter, "org-config.yaml", FILLED);
      g("add", "-A"); g("commit", "-qm", "seed");
      runUpgradePr(oldContent(), adopter, { userHome: tmp("gov445-home-") });   // push fails (no remote) — the branch still holds the commit
      expect(g("show", "gov-upgrade-1.2.3:org-config.yaml")).to.equal(FILLED);
    });
  });
});

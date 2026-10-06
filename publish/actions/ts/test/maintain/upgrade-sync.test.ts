// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
import { expect } from "chai";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { contentLayoutOf, staleArtifactsIn, parseManifest, expandEntries, planUpgrade, applyUpgrade, formatPlan, type PlanReaders } from "../../src/maintain/upgrade-sync.js";
import { splitOrgConfig, splitLoss } from "../../src/maintain/org-config-split.js";

const MANIFEST = `
version: "1.0.0"
files:
  - { src: VERSION, dst: VERSION, mode: scaffold-auto }
  - { src: CLAUDE.md, dst: CLAUDE.md, mode: scaffold-prompt }
  - { src: knowledge/guidance/, dst: knowledge/guidance/, mode: scaffold-prompt }
  - { src: org-config.example.yaml, dst: org-config.yaml, mode: seed-once }
owned:
  - org-config.yaml
  - projects/PRJ-*/
`;

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../..");

describe("gov-work — upgrade overlay-sync engine", () => {
  it("parses the MANIFEST (files + owned)", () => {
    const m = parseManifest(MANIFEST);
    expect(m.files).to.have.lengthOf(4);
    expect(m.files[0]).to.deep.equal({ src: "VERSION", dst: "VERSION", mode: "scaffold-auto" });
    expect(m.owned).to.include("org-config.yaml");
  });

  it("expands directory entries to per-file entries", () => {
    const m = parseManifest(MANIFEST);
    const exp = expandEntries(m, ["knowledge/guidance/a.md", "knowledge/guidance/sub/b.md", "other.md"]);
    const guidance = exp.filter((e) => e.dst.startsWith("knowledge/guidance/"));
    expect(guidance.map((e) => e.dst)).to.deep.equal(["knowledge/guidance/a.md", "knowledge/guidance/sub/b.md"]);
  });

  it("plans create / same / update / retire", () => {
    const content: Record<string, string> = { "VERSION": "1.0.0\n", "CLAUDE.md": "new claude\n", "org-config.example.yaml": 'org_name: ""\n' };
    const adopter: Record<string, string> = { "VERSION": "0.9.0\n", "CLAUDE.md": "new claude\n", "registry.yaml": "x", ".framework-version": "0.9.0", "framework/agent.md": "old" };
    const r: PlanReaders = {
      readContent: (p) => content[p] ?? null,
      readAdopter: (p) => adopter[p] ?? null,
      adopterPaths: () => Object.keys(adopter),
    };
    const m = parseManifest(MANIFEST);
    const plan = planUpgrade(expandEntries(m, []), r);
    const by = (k: string) => plan.actions.filter((a) => a.kind === k).map((a) => a.dst);
    expect(by("update")).to.include("VERSION");        // differs, scaffold-auto → overwrite
    expect(by("same")).to.include("CLAUDE.md");         // identical
    expect(by("create")).to.include("org-config.yaml"); // adopter has none → seed
    expect(by("retire")).to.have.members(["registry.yaml", ".framework-version", "framework/"]);
  });

  it("org-config.yaml is SEED-ONCE: created when absent, never rewritten — the template merge is gone", () => {
    const content: Record<string, string> = { "VERSION": "1.0.0\n", "org-config.example.yaml": 'org_name: ""\nnew_key: ""\n' };
    const store: Record<string, string> = { "VERSION": "0.9.0\n", "org-config.yaml": 'org_name: "Acme"\n', "registry.yaml": "x" };
    const removed: string[] = [];
    const plan = planUpgrade(
      [{ src: "VERSION", dst: "VERSION", mode: "scaffold-auto" }, { src: "org-config.example.yaml", dst: "org-config.yaml", mode: "seed-once" }],
      { readContent: (p) => content[p] ?? null, readAdopter: (p) => store[p] ?? null, adopterPaths: () => Object.keys(store) },
    );
    const res = applyUpgrade(plan, {
      readContent: (p) => content[p] ?? null,
      readAdopter: (p) => store[p] ?? null,
      writeAdopter: (p, t) => { store[p] = t; },
      removeAdopter: (p) => { removed.push(p); },
    });
    expect(store["VERSION"]).to.equal("1.0.0\n");                 // updated
    expect(store["org-config.yaml"]).to.equal('org_name: "Acme"\n'); // the org's, untouched — no template key added
    expect(removed).to.include("registry.yaml");                   // retired
    expect(res.applied).to.include("VERSION");
    expect(formatPlan(plan).join("\n")).to.match(/plan:/);
  });

  it("the shipped MANIFEST has no overlay-schema entry any more", () => {
    const m = parseManifest(fs.readFileSync(path.join(repoRoot, "publish", "content", "MANIFEST.yaml"), "utf8"));
    expect(m.files.find((f) => f.dst === "org-config.yaml")?.mode).to.equal("seed-once");
    expect(m.files.map((f) => f.mode as string)).to.not.include("overlay-schema");
  });
});


// PRJ-121, 2026-09-22 — the framework's own files left in an adopter repo by the template copy.
describe("planUpgrade — retires the framework's leftovers, only by fingerprint, only in an adopter repo", () => {
  const plan = (files: string[]) => planUpgrade([], { readContent: () => null, readAdopter: () => null, adopterPaths: () => files })
    .actions.filter((a) => a.kind === "retire").map((a) => a.dst);

  it("an adopter's inherited publish/, site/ and install.ps1 are retired", () => {
    expect(plan(["org-config.yaml", "publish/actions/ts/package.json", "publish/content/VERSION", "site/caddyfile.mjs", "install.ps1"]))
      .to.include.members(["publish/", "site/", "install.ps1"]);
  });

  it("the framework's OWN checkout (no org-config.yaml) is never told to delete publish/", () => {
    expect(plan(["publish/actions/ts/package.json", "site/caddyfile.mjs"])).to.not.include("publish/").and.not.include("site/");
  });

  it("an org's own site/ without the framework's fingerprint stays", () => {
    expect(plan(["org-config.yaml", "site/index.html"])).to.not.include("site/");
  });
});

// PRJ-121, 2026-09-23 (policy-split design §9). The shipped layout is about to change — governance/ becomes
// framework/ + policies/ — and upgrade could only CREATE and RETIRE. Applied to that change, it would have
// dropped an org's own exception files, its curated standard and its approved-agent list: worse than the old
// layout. So relocation comes first, and every relocation is a STRAIGHT MOVE (Policy Owner).
describe("upgrade — moving an org's own files to a new layout", () => {
  const MANIFEST = `
files:
  - { src: VERSION, dst: VERSION, mode: scaffold-auto }
moves:
  - { from: governance/policies/exceptions/, to: policies/exceptions/, mode: move }
  - { from: governance/policies/knowledge-organization-standard.md, to: policies/knowledge-organization-standard.md, mode: move }
  - { from: org-config.yaml, to: org-config.yaml, mode: migrate, how: approved-agents-to-org-config }
`;
  const manifest = parseManifest(MANIFEST);

  const readers = (adopter: Record<string, string>, done: string[] = []): PlanReaders => ({
    readContent: () => "shipped\n",
    readAdopter: (p) => adopter[p] ?? null,
    adopterPaths: () => Object.keys(adopter),
    doneMoves: () => done,
  });

  it("parses the moves section, straight moves and the one migration", () => {
    expect(manifest.moves).to.have.length(3);
    expect(manifest.moves[2]).to.include({ mode: "migrate", how: "approved-agents-to-org-config" });
  });

  it("plans a move for each of the org's files under a moved FOLDER, keeping the structure", () => {
    const plan = planUpgrade([], readers({
      "governance/policies/exceptions/legal/our-exception.md": "ours\n",
      "governance/policies/exceptions/policy/another.md": "ours\n",
    }), manifest.moves);
    const moves = plan.actions.filter((a) => a.kind === "move").map((a) => `${a.from} → ${a.dst}`);
    expect(moves).to.deep.equal([
      "governance/policies/exceptions/legal/our-exception.md → policies/exceptions/legal/our-exception.md",
      "governance/policies/exceptions/policy/another.md → policies/exceptions/policy/another.md",
    ]);
  });

  it("plans nothing for a file the org does not have", () => {
    expect(planUpgrade([], readers({ "VERSION": "1\n" }), manifest.moves).actions.filter((a) => a.kind === "move")).to.have.length(0);
  });

  it("runs ONCE: a relocation already recorded is not planned again", () => {
    const adopter = { "governance/policies/knowledge-organization-standard.md": "the org's, curated\n" };
    const id = "governance/policies/knowledge-organization-standard.md → policies/knowledge-organization-standard.md";
    expect(planUpgrade([], readers(adopter), manifest.moves).actions.some((a) => a.kind === "move"), "first run").to.equal(true);
    expect(planUpgrade([], readers(adopter, [id]), manifest.moves).actions.some((a) => a.kind === "move"), "second run").to.equal(false);
  });

  it("a MOVE carries the org's bytes, and leaves nothing behind", () => {
    const store: Record<string, string> = { "governance/policies/knowledge-organization-standard.md": "OUR taxonomy, curated\n" };
    const plan = planUpgrade([], readers(store), manifest.moves);
    const recorded: string[] = [];
    applyUpgrade(plan, {
      readContent: () => null,
      readAdopter: (p) => store[p] ?? null,
      writeAdopter: (p, t) => { store[p] = t; },
      removeAdopter: (p) => { delete store[p]; },
      recordMove: (id) => recorded.push(id),
    });
    expect(store["policies/knowledge-organization-standard.md"], "byte for byte").to.equal("OUR taxonomy, curated\n");
    expect(store["governance/policies/knowledge-organization-standard.md"], "and not left as a second copy").to.equal(undefined);
    expect(recorded, "and recorded, so it happens once").to.have.length(1);
  });

  it("a MIGRATION gov does not know is left undone — never half-applied, never recorded", () => {
    const store: Record<string, string> = { "org-config.yaml": "```yaml\napproved_agents:\n  - ibm-bob\n```\n" };
    const plan = planUpgrade([], readers(store), manifest.moves);
    const recorded: string[] = [];
    const res = applyUpgrade(plan, {
      readContent: () => null,
      readAdopter: (p) => store[p] ?? null,
      writeAdopter: (p, t) => { store[p] = t; },
      removeAdopter: (p) => { delete store[p]; },
      migrate: () => false,                       // an older CLI, a newer manifest
      recordMove: (id) => recorded.push(id),
    });
    expect(store["org-config.yaml"], "the org's file is untouched").to.not.equal(undefined);
    expect(recorded, "and nothing is recorded, so a later gov still runs it").to.deep.equal([]);
    expect(res.skipped).to.contain("org-config.yaml");
  });

  it("a migration that RUNS is recorded once", () => {
    const store: Record<string, string> = { "org-config.yaml": "fence\n" };
    const recorded: string[] = [];
    applyUpgrade(planUpgrade([], readers(store), manifest.moves), {
      readContent: () => null, readAdopter: (p) => store[p] ?? null,
      writeAdopter: (p, t) => { store[p] = t; }, removeAdopter: (p) => { delete store[p]; },
      migrate: () => true, recordMove: (id) => recorded.push(id),
    });
    expect(recorded).to.deep.equal(["org-config.yaml → org-config.yaml"]);
  });

  // RETIRE ONLY AFTER VERIFY: the old tree goes only when nothing is still moving out of it.
  it("does not retire a path a move is taking files out of", () => {
    const moves = parseManifest(`
moves:
  - { from: framework/, to: policies/, mode: move }
`).moves;
    const plan = planUpgrade([], readers({ "org-config.yaml": "x", "framework/ours.md": "ours" }), moves);
    expect(plan.actions.filter((a) => a.kind === "retire").map((a) => a.dst), "framework/ is retired by RETIRE_PATHS — but not while it is being emptied").to.not.include("framework/");
    expect(plan.actions.some((a) => a.kind === "move" && a.dst === "policies/ours.md")).to.equal(true);
  });

  it("the plan says what will happen to the org's files, by name", () => {
    const text = formatPlan(planUpgrade([], readers({ "governance/policies/exceptions/legal/x.md": "ours" }), manifest.moves)).join("\n");
    expect(text).to.contain("→ move").and.contain("governance/policies/exceptions/legal/x.md → policies/exceptions/legal/x.md");
  });
});

// PRJ-121 Tier 0 #5, 2026-10-06 — `gov upgrade` emptied an organization's governance repo name: a name-only merge of
// the template put `org_gov_repo:` in EMPTY and commented the org's `workspace_repo:` out. The org-config split removed
// the merge (two writers of one file); the rename now travels in the one recorded migration, and a migration that
// would lose a value gov reads is REFUSED — planned as a refusal, and never written.
describe("the org-config split — a rename carries the value; a migration that would lose one is refused", () => {
  const ORG = 'org_name: "Acme"\nworkspace_repo: "acme-gov"\ndefault_branch: "trunk"\n';

  it("workspace_repo's value lands under org_gov_repo, in place, and is not left behind", () => {
    const out = splitOrgConfig({ orgConfig: ORG, governance: null, roleList: null }).orgConfig;
    expect(out).to.equal('org_name: "Acme"\norg_gov_repo: "acme-gov"\ndefault_branch: "trunk"\n');
  });

  it("an org that already has org_gov_repo keeps it, and a stale workspace_repo beside it goes", () => {
    const out = splitOrgConfig({ orgConfig: 'org_gov_repo: "new-gov"\nworkspace_repo: "old-gov"\n', governance: null, roleList: null }).orgConfig;
    expect(out).to.equal('org_gov_repo: "new-gov"\n');
  });

  it("splitLoss names every value gov reads that would not survive", () => {
    const input = { orgConfig: ORG, governance: null, roleList: null };
    expect(splitLoss(input, splitOrgConfig(input))).to.deep.equal([]);
    expect(splitLoss(input, { ...splitOrgConfig(input), orgConfig: 'org_name: "Acme"\norg_gov_repo: ""\ndefault_branch: "trunk"\n' }))
      .to.deep.equal(['workspaceRepo ("acme-gov")']);
  });

  // THE CHECK OWNER may arrive vacant (rule-model P1 rulings): an org that never named one moves with check_owner
  // empty — that empties nothing, so the guard must not refuse; an org that named one keeps it.
  it("a vacant Check Owner does not trip the loss guard, and a named one is carried", () => {
    const before = 'org_name: "Acme"\norg_gov_repo: "acme-gov"\npolicy_owner_github: "@carol"\ncheck_owner_github: ""\n';
    const input = { orgConfig: before, governance: null, roleList: null };
    expect(splitLoss(input, splitOrgConfig(input))).to.deep.equal([]);
    const named = { ...input, orgConfig: `${before.replace('check_owner_github: ""\n', "")}check_owner_github: "@dave"\n` };
    expect(splitLoss(named, splitOrgConfig(named))).to.deep.equal([]);
    expect(splitOrgConfig(named).governance).to.match(/github: "@dave"/);
  });

  const lossy = () => {
    const moves = [{ from: "org-config.yaml", to: "policies/governance.yaml", mode: "migrate" as const, how: "org-config-split" }];
    const store: Record<string, string> = { "org-config.yaml": 'org_name: "Acme"\npolicy_owner_github: "po"\n' };
    const r = {
      readContent: () => null, readAdopter: (p: string) => store[p] ?? null, adopterPaths: () => Object.keys(store),
      checkMigration: () => ['policy_owner_github ("po")'],
    };
    return { store, plan: planUpgrade([], r, moves) };
  };

  it("planUpgrade marks such a migration `refuse`, naming what it would lose", () => {
    const [a] = lossy().plan.actions;
    expect(a!.kind).to.equal("refuse");
    expect(a!.detail).to.match(/policy_owner_github/);
    expect(formatPlan(lossy().plan).join("\n")).to.match(/refuse/);
  });

  it("applyUpgrade never runs a refused migration — not even with includeConflicts, which `--pr` passes", () => {
    const { store, plan } = lossy();
    let ran = false;
    const res = applyUpgrade(plan, {
      readContent: () => null, readAdopter: (p) => store[p] ?? null,
      writeAdopter: (p, t) => { store[p] = t; }, removeAdopter: () => {},
      migrate: () => { ran = true; return true; },
    }, { includeConflicts: true });
    expect(ran).to.equal(false);
    expect(res.refused).to.deep.equal(["policies/governance.yaml"]);
  });

  it("a migration that refuses while running writes nothing and is not recorded", () => {
    const moves = [{ from: "org-config.yaml", to: "policies/governance.yaml", mode: "migrate" as const, how: "org-config-split" }];
    const plan = planUpgrade([], { readContent: () => null, readAdopter: () => "x", adopterPaths: () => ["org-config.yaml"] }, moves);
    const recorded: string[] = [];
    const res = applyUpgrade(plan, {
      readContent: () => null, readAdopter: () => "x", writeAdopter: () => {}, removeAdopter: () => {},
      migrate: () => "it would lose something", recordMove: (id) => recorded.push(id),
    });
    expect(recorded).to.deep.equal([]);
    expect(res.refused).to.deep.equal(["policies/governance.yaml"]);
    expect(res.why.join("\n")).to.match(/would lose something/);
  });

  // Tier 0 #7 — the new layout lives under a path RETIRE_PATHS names for the old world.
  it("never retires a RETIRE_PATHS directory the manifest ships into — `framework/` is the new layout", () => {
    const shipped = [{ src: "framework/rules/rules.yaml", dst: "framework/rules/rules.yaml", mode: "scaffold-auto" as const }];
    const plan = planUpgrade(shipped, {
      readContent: () => "rows\n",
      readAdopter: (p) => (p === "framework/rules/rules.yaml" ? "rows\n" : "x"),
      adopterPaths: () => ["framework/rules/rules.yaml", "framework/docs/specs/framework-specification.md", "registry.yaml"],
    });
    const retired = plan.actions.filter((a) => a.kind === "retire").map((a) => a.dst);
    expect(retired).to.not.include("framework/");
    expect(retired, "the other old-world paths are still retired").to.include("registry.yaml");
  });

  it("parses the MANIFEST's retire list, and retires exactly the listed paths the workspace has", () => {
    const m = parseManifest(`
files:
  - { src: VERSION, dst: VERSION, mode: scaffold-auto }
retire:
  - framework/policies/framework-policy.md
  - framework/policies/        # the folder
  - framework/docs/specs/concepts.md
`);
    expect(m.retire).to.deep.equal(["framework/policies/framework-policy.md", "framework/policies/", "framework/docs/specs/concepts.md"]);
    const plan = planUpgrade([], {
      readContent: () => null, readAdopter: () => "x",
      adopterPaths: () => ["framework/policies/framework-policy.md", "framework/policies/README.md", "framework/docs/specs/x.md"],
    }, [], m.retire);
    const retired = plan.actions.filter((a) => a.kind === "retire").map((a) => a.dst);
    expect(retired).to.include.members(["framework/policies/framework-policy.md", "framework/policies/"]);
    expect(retired, "an unlisted file is not retired by the list").to.not.include("framework/docs/specs/concepts.md");
  });

  it("a retire entry never removes a file the manifest ships — shipping wins, and the entry is reported", () => {
    const shipped = [{ src: "VERSION", dst: "VERSION", mode: "scaffold-auto" as const }];
    const plan = planUpgrade(shipped, { readContent: () => "1\n", readAdopter: () => "1\n", adopterPaths: () => ["VERSION"] }, [], ["VERSION"]);
    expect(plan.actions.filter((a) => a.kind === "retire")).to.deep.equal([]);
  });

  it("the shipped MANIFEST retires nothing it also ships", () => {
    const content = path.join(repoRoot, "publish", "content");
    const m = parseManifest(fs.readFileSync(path.join(content, "MANIFEST.yaml"), "utf8"));
    const walk = (rel: string): string[] => fs.readdirSync(path.join(content, rel)).flatMap((n) => {
      const r = rel ? `${rel}/${n}` : n;
      return fs.statSync(path.join(content, r)).isDirectory() ? walk(r) : [r];
    });
    const dsts = expandEntries(m, walk("")).map((e) => e.dst);
    const clash = m.retire.filter((r) => (r.endsWith("/") ? dsts.some((d) => d.startsWith(r)) : dsts.includes(r)));
    expect(clash).to.deep.equal([]);
  });

  it("doctor does not call the new framework/ tree an old-world artifact", () => {
    const has = (...p: string[]) => (rel: string) => p.includes(rel);
    expect(staleArtifactsIn(true, has("org-config.yaml", "framework", "framework/rules"))).to.not.include("framework/");
    expect(staleArtifactsIn(true, has("org-config.yaml", "framework", "framework/docs"))).to.not.include("framework/");
    expect(staleArtifactsIn(true, has("org-config.yaml", "framework")), "a framework/ with none of the new layout is the old world").to.include("framework/");
  });

  it("a workspace with the rule store but no framework/policies/ is on the current layout", () => {
    expect(contentLayoutOf((r) => r === "framework/rules")).to.equal("framework");
    expect(contentLayoutOf((r) => r === "framework/docs/specs")).to.equal("framework");
  });
});

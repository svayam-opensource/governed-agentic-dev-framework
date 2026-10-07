// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * ADOPTION WALK #4 + #14 — DATA LOSS (Rocky 9, svm-geneva, 2026-10-07).
 *
 * `gov setup` on an existing governance repo in the OLD layout (`governance/`, no `policies/governance.yaml`) wrote
 * org-config.yaml in the new identity-only shape. That rewrite DELETED the old keys only the upgrade's org-config
 * split knows how to carry — the domain role holders, the work root — before the upgrade could carry them; and the
 * seed that followed failed for want of the framework/ tree only the upgrade installs.
 *
 * THE DESIGN: setup detects the old layout BEFORE IT ASKS ANYTHING, and runs (or, when it cannot, demands) the
 * upgrade first. The upgrade's split carries every old value into the current layout; setup then asks against the
 * current layout and writes each answer where that layout keeps it, by targeted edit. Nothing is written in a shape a
 * later step must translate, so no answer depends on a migration that refuses on disagreement.
 */
import { expect } from "chai";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { runSetup, type SetupIo } from "../../src/setup/setup-run.js";
import { readExistingOrgConfig, setupNeedsUpgrade } from "../../src/setup/setup.js";
import { GOVERNANCE_PATH, parseGovernance } from "../../src/config/governance.js";
import { ROLE_LIST_PATH, parseRoleList } from "../../src/config/role-list.js";
import { runUpgradeSync } from "../../src/maintain/upgrade-run.js";
import { createNodeFs } from "../../src/lifecycle/fs-io.js";

const CONTENT = fileURLToPath(new URL("../../../../content/", import.meta.url));
const OLD_CONFIG = fs.readFileSync(fileURLToPath(new URL("../maintain/fixtures/svayam-org-config.yaml", import.meta.url)), "utf8");

/** An old-layout governance repo: governance/policies/, an org-config with the governance keys, agents in llm-governance.md. */
function oldLayoutRepo(): { ws: string; home: string } {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), "gov-old-layout-"));
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "gov-old-layout-home-"));
  fs.writeFileSync(path.join(ws, "org-config.yaml"), OLD_CONFIG);
  fs.mkdirSync(path.join(ws, "governance", "policies"), { recursive: true });
  fs.writeFileSync(path.join(ws, "governance", "policies", "llm-governance.md"), "```yaml\napproved_agents:\n  - id: ibm-bob\n    default: true\n```\n");
  return { ws, home };
}

/** The walk's answers, by question. Anything not named takes its default. */
const ANSWERS: Array<[RegExp, string]> = [
  [/Policy Owner GitHub handle/, "@alice"],
  [/Check Owner GitHub handle/, "@bob"],
  [/contact email/i, "alice@geneva.test"],
  [/still want the governance posture/, "y"],          // the hard-posture confirmation — before the posture question
  [/governance posture/, "2"],
];

function io(ws: string, over: Partial<SetupIo> = {}): SetupIo & { asked: string[]; printed: string[] } {
  const asked: string[] = [];
  const printed: string[] = [];
  return {
    asked, printed,
    fs: createNodeFs(), cwd: ws, originUrl: "git@github.com:svm-geneva/svm-geneva-gov.git",
    ghUser: "carol", gitEmail: "carol@geneva.test", today: "2026-10-07",
    existing: readExistingOrgConfig(OLD_CONFIG, null),
    prompt: async (q, def) => { asked.push(q); return ANSWERS.find(([re]) => re.test(q))?.[1] ?? def; },
    print: (l) => printed.push(l),
    ...over,
  };
}

describe("GOV-FRM-445 — setup on an old-layout repo loses no answer (walk #4, #14)", () => {
  let ws: string;
  let home: string;
  beforeEach(() => ({ ws, home } = oldLayoutRepo()));
  afterEach(() => { fs.rmSync(ws, { recursive: true, force: true }); fs.rmSync(home, { recursive: true, force: true }); });

  it("GOV-FRM-445 an old-layout repo + setup answers → every answer survives into policies/governance.yaml after setup + upgrade", async () => {
    const upgrade = (): number => runUpgradeSync(CONTENT, ws, { apply: true, userHome: home }).code;
    const s = io(ws, { upgradeFirst: upgrade });
    expect(await runSetup(s, true), s.printed.join("\n")).to.equal(0);
    // …and an upgrade after setup must not undo any of it.
    expect(upgrade()).to.equal(0);

    const gov = parseGovernance(fs.readFileSync(path.join(ws, GOVERNANCE_PATH), "utf8"));
    expect(gov.policyOwner.github, "Q8").to.equal("@alice");
    expect(gov.checkOwner.github, "Q9").to.equal("@bob");
    expect(gov.policyOwner.email, "Q10").to.equal("alice@geneva.test");
    expect(gov.posture.raw, "Q11").to.equal("hard");
    expect(gov.authorizedAgents, "the agents the old layout authorized").to.deep.equal({ kind: "agents", agents: [{ id: "ibm-bob", default: true }] });
    // And what the old org-config held that setup does not ask: carried by the upgrade, not deleted by setup.
    const roles = parseRoleList(fs.readFileSync(path.join(ws, ROLE_LIST_PATH), "utf8"));
    expect(roles.found && roles.roles.find((r) => r.role === "Legal Owner")?.holder, "the domain role holders survive").to.equal("@svayam-rkant");
    // The old layout is gone: framework/ installed, so the seed that failed in the walk now has its templates.
    expect(fs.existsSync(path.join(ws, "framework", "templates", "todo-template.md"))).to.equal(true);
  });

  it("the upgrade runs BEFORE the first question — nothing is asked about a layout setup cannot write", async () => {
    const order: string[] = [];
    const s = io(ws, {
      upgradeFirst: () => { order.push("upgrade"); return runUpgradeSync(CONTENT, ws, { apply: true, userHome: home }).code; },
      prompt: async (q, def) => { order.push(/Upgrade it now/.test(q) ? "offer" : "ask"); return ANSWERS.find(([re]) => re.test(q))?.[1] ?? def; },
    });
    expect(await runSetup(s, true)).to.equal(0);
    // Offered (Enter = yes), run, and only then the questions.
    expect(order.slice(0, 3)).to.deep.equal(["offer", "upgrade", "ask"]);
  });

  it("with no way to upgrade (non-interactive), setup refuses and writes NOTHING — naming the command", async () => {
    const before = fs.readFileSync(path.join(ws, "org-config.yaml"), "utf8");
    const s = io(ws);
    expect(await runSetup(s, false)).to.equal(1);
    expect(fs.readFileSync(path.join(ws, "org-config.yaml"), "utf8"), "org-config untouched").to.equal(before);
    expect(fs.existsSync(path.join(ws, GOVERNANCE_PATH))).to.equal(false);
    expect(s.asked).to.deep.equal([]);
    expect(s.printed.join("\n")).to.contain("gov upgrade --apply");
  });

  it("an upgrade that fails stops setup — nothing written after it", async () => {
    const before = fs.readFileSync(path.join(ws, "org-config.yaml"), "utf8");
    const s = io(ws, { upgradeFirst: () => 1 });
    expect(await runSetup(s, true)).to.equal(1);
    expect(fs.readFileSync(path.join(ws, "org-config.yaml"), "utf8")).to.equal(before);
    expect(s.asked.map((q) => /Upgrade it now/.test(q))).to.deep.equal([true]);
  });

  it("declining the offer writes nothing and names the command", async () => {
    const before = fs.readFileSync(path.join(ws, "org-config.yaml"), "utf8");
    let ran = false;
    const s = io(ws, { upgradeFirst: () => { ran = true; return 0; }, prompt: async () => "n" });
    expect(await runSetup(s, true)).to.equal(1);
    expect(ran).to.equal(false);
    expect(fs.readFileSync(path.join(ws, "org-config.yaml"), "utf8")).to.equal(before);
    expect(s.printed.join("\n")).to.contain("gov upgrade --apply");
  });

  it("detection: the old layout, or org-config keys only the upgrade can carry; a current repo is not flagged", () => {
    const has = (paths: string[]) => (rel: string): boolean => paths.includes(rel);
    expect(setupNeedsUpgrade(has(["governance/policies"]), "", null)).to.match(/old layout/);
    expect(setupNeedsUpgrade(has([]), 'org_slug: "ACME"\nlegal_owner_github: "@l"\n', null)).to.match(/legal_owner_github/);
    expect(setupNeedsUpgrade(has(["framework/rules"]), 'org_slug: "ACME"\n', "governance_posture: soft\n")).to.equal(null);
    // An org-config that predates the split, with only what setup itself carries, is still setup's to handle.
    expect(setupNeedsUpgrade(has([]), 'org_slug: "ACME"\npolicy_owner_github: "@po"\n', null)).to.equal(null);
  });
});

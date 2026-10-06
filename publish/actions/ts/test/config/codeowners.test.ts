// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * CODEOWNERS is generated, and the generation is the fix (Decisions 7, 8, 13 — 2026-09-14).
 *
 * The shipped template reached every adopter with seven unresolved tokens, because the token
 * sweep covered `agent/` and `knowledge/` and never the repo root. GitHub cannot resolve
 * `<POLICY_OWNER_GITHUB>`, so no rule applied and `governance/policies/` was unprotected
 * everywhere — while the policy said changes there need the Policy Owner. Every test passed.
 *
 * These tests exist because that is not a bug you find by reading output.
 */
import { expect } from "chai";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import {
  renderCodeowners, unresolvedTokens, normalizeHandle, codeownersDrift, POLICY_OWNER_PATHS, CHECK_OWNER,
} from "../../src/config/codeowners.js";
import type { RoleHolder } from "../../src/config/role-list.js";
import { ORG_CONFIG_KEYS } from "../../src/config/org-config.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../..");

describe("CODEOWNERS generation", () => {
  it("a Policy Owner is required — no owner means no file, not a partial one", () => {
    // Refusing is the point. A CODEOWNERS missing its floor protects nothing, and that state is
    // indistinguishable from the broken template it replaces.
    expect(renderCodeowners({}, [])).to.equal(null);
    expect(renderCodeowners({ policyOwner: "   " }, []), "blank is not a holder").to.equal(null);
    expect(renderCodeowners({ checkOwner: "x" }, [{ role: "Legal Owner", holder: "@x", owns: ["knowledge/legal/"] }]), "no other role can stand in").to.equal(null);
  });

  it("org-config.yaml and policies/governance.yaml are gated, and listed FIRST", () => {
    // Decision 6: governance.yaml holds the framework roles' handles (since the org-config split), so an ungated copy
    // is a route to naming yourself the approver of everything else. First because order is how a reader sees it.
    const r = renderCodeowners({ policyOwner: "rkant" }, [])!;
    const rules = r.text.split("\n").filter((l) => l.startsWith("/"));
    expect(rules[0]).to.match(/^\/org-config\.yaml\s+@rkant$/);
    expect(rules[1]).to.match(/^\/policies\/governance\.yaml\s+@rkant$/);
    for (const p of POLICY_OWNER_PATHS) expect(r.text).to.contain(p);
  });

  // GOV-FRM-083 (W2-Q7): every folder of knowledge/ and policies/ routes to a named owner — the role list's holder
  // where a role owns the folder, the Policy Owner everywhere else — and policies/actions/ to the Check Owner.
  const ROLES: readonly RoleHolder[] = [
    { role: "Data Owner", holder: "@dana", owns: ["knowledge/data/"] },
    { role: "Legal Owner", holder: null, owns: ["knowledge/legal/", "knowledge/contracts/"] },
    { role: "Security Lead", holder: "@sec", owns: [] },
  ];
  const ruleLines = (text: string): string[][] =>
    text.split("\n").filter((l) => l.startsWith("/")).map((l) => l.split(/\s+/));
  const ownerOf = (text: string, file: string): string | undefined => {
    // CODEOWNERS' own semantics: the LAST matching pattern wins.
    let hit: string | undefined;
    for (const [pat, who] of ruleLines(text)) {
      const p = pat!.replace(/^\//, "");
      if (p.endsWith("/") ? file.startsWith(p) : file === p) hit = who;
    }
    return hit;
  };

  it("GOV-FRM-083 every folder of knowledge/ and policies/ routes to a named owner — the Policy Owner when no role owns it", () => {
    const r = renderCodeowners({ policyOwner: "polly", checkOwner: "chuck" }, ROLES)!;
    expect(r.text).to.match(/^\/knowledge\/\s+@polly$/m);
    expect(r.text).to.match(/^\/policies\/\s+@polly$/m);
    for (const f of ["knowledge/anything/x.md", "knowledge/top.md", "policies/org-policy.md", "policies/rules.yaml"]) {
      expect(ownerOf(r.text, f), f).to.equal("@polly");
    }
  });

  it("GOV-FRM-083 a role's knowledge/ folder routes to its holder; a VACANT role's folder to the Policy Owner", () => {
    const r = renderCodeowners({ policyOwner: "polly", checkOwner: "chuck" }, ROLES)!;
    expect(ownerOf(r.text, "knowledge/data/model.md")).to.equal("@dana");
    expect(ownerOf(r.text, "knowledge/legal/nda.md"), "vacant → the Policy Owner, never no line").to.equal("@polly");
    expect(ownerOf(r.text, "knowledge/contracts/msa.md")).to.equal("@polly");
    expect(r.text).to.match(/# Legal Owner — vacant/);
    expect(r.vacant).to.deep.equal(["Legal Owner"]);
    expect(r.text, "a role that owns no folder adds no line").to.not.contain("Security Lead");
  });

  it("GOV-FRM-083 policies/actions/ routes to the Check Owner, and comes last so it wins over /policies/", () => {
    const r = renderCodeowners({ policyOwner: "polly", checkOwner: "chuck" }, ROLES)!;
    expect(ownerOf(r.text, "policies/actions/spdx/action.yml")).to.equal("@chuck");
    const pats = ruleLines(r.text).map(([p]) => p);
    expect(pats.at(-1)).to.equal("/policies/actions/");
  });

  it("GOV-FRM-083 the stale /governance/ line is gone — that tree no longer exists", () => {
    const r = renderCodeowners({ policyOwner: "polly" }, ROLES)!;
    expect(r.text).to.not.match(/^\/governance\//m);
    expect(POLICY_OWNER_PATHS).to.not.include("/governance/");
  });

  it("without a role list, the org defines no roles — the retired *_owner_github keys route nothing", () => {
    const r = renderCodeowners({ policyOwner: "rkant" }, [])!;
    expect(ownerOf(r.text, "knowledge/legal/x.md")).to.equal("@rkant");
    expect(r.text).to.not.contain("Legal Owner");
    expect(r.vacant).to.deep.equal([]);
  });

  it("GOV-FRM-083 a hand-edited CODEOWNERS that no longer matches what gov generates is reported as drift", () => {
    const want = renderCodeowners({ policyOwner: "polly", checkOwner: "chuck" }, ROLES)!.text;
    expect(codeownersDrift(want, want)).to.equal(null);
    expect(codeownersDrift(`${want}\n# a note someone added\n`, want), "a comment is not a route").to.equal(null);
    expect(codeownersDrift(want.replace(/^(\/policies\/actions\/\s+)@chuck$/m, "$1@mallory"), want))
      .to.deep.equal({ missing: ["/policies/actions/ @chuck"], extra: ["/policies/actions/ @mallory"], reordered: false });
    expect(codeownersDrift(`${want}/secret/ @mallory\n`, want)!.extra).to.deep.equal(["/secret/ @mallory"]);
    const lines = want.split("\n");
    const a = lines.findIndex((l) => l.startsWith("/policies/actions/")), b = lines.findIndex((l) => l.startsWith("/policies/ "));
    [lines[a], lines[b]] = [lines[b]!, lines[a]!];
    expect(codeownersDrift(lines.join("\n"), want), "order is routing: the last match wins").to.deep.equal({ missing: [], extra: [], reordered: true });
  });

  // THE CHECK OWNER (rule-model P1 rulings, 2026-10-06): the framework's second built-in role. The Policy Owner
  // approves what a rule MEANS; the Check Owner approves the CODE that enforces it — `policies/actions/` holds
  // executable actions, and an action is code that runs in CI with the org's tokens.
  it("policies/actions/ is the Check Owner's, on a line of its own", () => {
    const r = renderCodeowners({ policyOwner: "rkant", checkOwner: "@checker" }, [])!;
    expect(CHECK_OWNER.key).to.equal("check_owner.github");
    expect(r.text).to.match(/^# Check Owner/m);
    expect(r.text).to.match(/^\/policies\/actions\/\s+@checker$/m);
    expect(r.escalated).to.deep.equal([]);
  });

  it("GOV-FRM-083 GOV-FRM-033 a VACANT Check Owner escalates to the Policy Owner — the line is never dropped", () => {
    // Unlike a domain role, whose paths do not exist until the role is held, `policies/actions/` exists the moment
    // an org authors a check. An ungated actions directory is code anyone with write access can make CI run.
    for (const vacant of [{}, { checkOwner: "" }, { checkOwner: "  " }]) {
      const r = renderCodeowners({ policyOwner: "rkant", ...vacant }, [])!;
      expect(r.text).to.match(/^\/policies\/actions\/\s+@rkant$/m);
      expect(r.text).to.match(/vacant/);
      expect(r.escalated).to.deep.equal(["Check Owner"]);
      expect(r.vacant, "vacant lists the org's roles; the Check Owner is reported as escalated").to.not.include("Check Owner");
    }
  });

  it("the Check Owner line comes after every Policy Owner path — CODEOWNERS' last match wins", () => {
    const r = renderCodeowners({ policyOwner: "rkant", checkOwner: "checker" }, [])!;
    const rules = r.text.split("\n").filter((l) => l.startsWith("/"));
    const at = rules.findIndex((l) => l.startsWith("/policies/actions/"));
    for (const p of POLICY_OWNER_PATHS) expect(rules.findIndex((l) => l.startsWith(p))).to.be.lessThan(at);
  });

  it("the Check Owner is set in policies/governance.yaml, and the shipped template carries it beside the Policy Owner", () => {
    expect(ORG_CONFIG_KEYS).to.not.include("check_owner_github");
    const tpl = fs.readFileSync(path.join(repoRoot, "publish", "content", "policies", "governance.yaml"), "utf8");
    expect(tpl).to.match(/^policy_owner:\n {2}email: ""\n {2}github: ""\n/m);
    expect(tpl).to.match(/^check_owner:\n {2}github: ""$/m);
  });

  it("handles are normalised, so `@x` and `x` cannot produce `@@x`", () => {
    expect(normalizeHandle("rkant")).to.equal("@rkant");
    expect(normalizeHandle("@rkant")).to.equal("@rkant");
    expect(normalizeHandle("@@rkant")).to.equal("@rkant");
    expect(normalizeHandle("")).to.equal(null);
    expect(normalizeHandle(undefined)).to.equal(null);
  });

  it("the generated file carries NO unresolved token", () => {
    const r = renderCodeowners({ policyOwner: "rkant" }, [{ role: "Legal Owner", holder: "@lawyer", owns: ["knowledge/legal/"] }])!;
    expect(unresolvedTokens(r.text)).to.deep.equal([]);
  });

  it("unresolvedTokens catches what shipped for months", () => {
    // The exact seven from the old template.
    const old = "knowledge/policies/ <POLICY_OWNER_GITHUB>\nknowledge/legal/ <LEGAL_OWNER_GITHUB>\n";
    expect(unresolvedTokens(old)).to.deep.equal(["<POLICY_OWNER_GITHUB>", "<LEGAL_OWNER_GITHUB>"]);
    expect(unresolvedTokens("/x @rkant"), "and does not cry wolf").to.deep.equal([]);
  });

  it("no CODEOWNERS template ships any more", () => {
    // The whole failure mode was a shipped file with tokens in it. If one reappears in
    // publish/content, the sweep gap can reappear with it.
    expect(
      fs.existsSync(path.join(repoRoot, "publish", "content", "CODEOWNERS")),
      "publish/content/CODEOWNERS must not exist — CODEOWNERS is generated",
    ).to.equal(false);
  });

  it("nothing shipped will be substituted into an ACCESS-CONTROL file", () => {
    // Narrower than my first version, which flagged two legitimate documentation mentions: the
    // manifest's own comment explaining this defect, and the protocol's token-mapping table.
    // Documentation naming a token is fine. What must never ship is a file that GRANTS ACCESS
    // and waits for a token to be filled in — because when the sweep misses it, the file looks
    // like a gate and enforces nothing. CODEOWNERS is the only such file.
    const content = path.join(repoRoot, "publish", "content");
    const walk = (d: string): string[] => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) =>
      e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]);
    const accessFiles = walk(content).filter((f) => path.basename(f) === "CODEOWNERS");
    expect(accessFiles, "no CODEOWNERS may ship at all").to.deep.equal([]);
  });

  it("no manifest entry uses scaffold-prompt, because readBaseline does not exist", () => {
    // The guard for the decision, not the decision itself. scaffold-prompt needs a baseline to
    // distinguish "we changed it" from "they changed it"; `readBaseline` is declared, called,
    // and implemented nowhere, so every difference became a skipped conflict. If an entry
    // reappears in this mode, that silent-skip behaviour comes back with it.
    const manifest = fs.readFileSync(path.join(repoRoot, "publish", "content", "MANIFEST.yaml"), "utf8");
    const entries = manifest.match(/\{\s*src:[^}]*mode:\s*scaffold-prompt\s*\}/g) ?? [];
    expect(entries, "implement readBaseline before using scaffold-prompt again").to.deep.equal([]);
  });

  it("the shipped protocol source matches the one the renderer reads", () => {
    // FOUND WHILE WRITING THESE TESTS. publish/content/agent/session-protocol.md had drifted to
    // the pre-2026-09-11 protocol — no version marker — while every rendered harness file came
    // from agent/session-protocol.md at the repo root. So adopters were seeded with a stale
    // source alongside current renders: two copies, and the one shipped as authoritative was
    // the out-of-date one (GOV-FRM-402).
    const shipped = fs.readFileSync(path.join(repoRoot, "publish", "content", "agent", "session-protocol.md"), "utf8");
    const source = fs.readFileSync(path.join(repoRoot, "agent", "session-protocol.md"), "utf8");
    expect(shipped, "publish/content's copy has drifted from the render source").to.equal(source);
  });
});

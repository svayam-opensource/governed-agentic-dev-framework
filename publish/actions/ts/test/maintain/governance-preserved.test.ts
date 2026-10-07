// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * GOV-FRM-445 — gov never changes what an organization WROTE in policies/governance.yaml. It may seed the file when it
 * is absent, and fill a value that is empty; nothing else.
 *
 * The defect these hold (adopter-e2e live tier, run 37550667671, 2026-10-07): `gov setup --non-interactive` re-rendered
 * the whole file from its answers, so an org's `models:` block — the approved model, `ci_allowed: true` — and every key
 * gov does not know were dropped. The org's file goes through setup, `gov upgrade --apply` and `gov app setup`, and comes
 * out byte for byte as it went in, except a key setup owns whose answer differs.
 */
import { expect } from "chai";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { runSetup } from "../../src/setup/setup-run.js";
import { deriveOrgConfig, readExistingOrgConfig, renderOrgConfig } from "../../src/setup/setup.js";
import { GOVERNANCE_PATH, parseGovernance } from "../../src/config/governance.js";
import { splitOrgConfig } from "../../src/maintain/org-config-split.js";
import { runUpgradeSync } from "../../src/maintain/upgrade-run.js";
import { appSetup, type AppSetupDeps, type GhOutcome, type GhRun } from "../../src/cli/app-verb.js";
import type { Fs } from "../../src/lifecycle/fs-io.js";
import { px } from "../helpers/paths.js";

const CONTENT = fileURLToPath(new URL("../../../../content/", import.meta.url));
const CTX = { originUrl: "git@github.com:Acme/acme-gov.git", ghUser: "rk", gitEmail: "rk@acme.io", today: "2026-10-07" };

/** An org's own governance.yaml: its comments, a models block, an agent list, and a key gov does not read. */
const ORG_GOV = `# Acme's governance choices — edited by hand, reviewed by the Policy Owner.
governance_posture: "soft"   # we are on GitHub Free

policy_owner:
  email: "rk@acme.io"
  github: "@rk"

check_owner:
  github: "@rk"

authorized_agents:
  default: "claude-code"
  agent1: "cursor"

knowledge_publication: "none"

# The model we approved for propose, and CI may use it.
models:
  propose:
    provider: "gemini"
    model: "gemini-2.5-pro"
  command: ""
  ci_allowed: true

# Ours, not gov's: gov reports it and leaves it alone.
escalation_channel: "#gov-escalations"
`;

const ORG_CONFIG = renderOrgConfig(deriveOrgConfig({ orgName: "Acme Inc", orgShortName: "Acme", orgSlug: "ACME" }, CTX));

/** An in-memory workspace with org-config.yaml and the org's governance.yaml; writes land in `files`. */
function memFs(files: Record<string, string>): Fs {
  return {
    writeFile: (f: string, c: string) => { files[px(f)] = c; },
    pathExists: (f: string) => px(f) in files,
    readFile: (f: string) => files[px(f)] ?? null,
    mkdirp: () => {}, rm: () => {}, readdir: () => [],
  } as Fs;
}

async function setupOver(gov: string, existing: Record<string, string> = {}): Promise<{ code: number; files: Record<string, string> }> {
  const files: Record<string, string> = { "/repo/org-config.yaml": ORG_CONFIG, "/repo/policies/governance.yaml": gov };
  const code = await runSetup({
    fs: memFs(files), cwd: "/repo", originUrl: CTX.originUrl, ghUser: CTX.ghUser, gitEmail: CTX.gitEmail, today: CTX.today,
    existing: { ...readExistingOrgConfig(ORG_CONFIG, gov), ...existing }, prompt: async (_q, d) => d, print: () => {},
  }, false);
  return { code, files };
}

describe("GOV-FRM-445 — the org's governance.yaml survives setup, upgrade and app setup", () => {
  it("GOV-FRM-445 gov setup --non-interactive leaves the org's governance.yaml byte for byte — models block, agents, custom key, comments", async () => {
    const { code, files } = await setupOver(ORG_GOV);
    expect(code).to.equal(0);
    expect(files["/repo/policies/governance.yaml"]).to.equal(ORG_GOV);
    expect(parseGovernance(files["/repo/policies/governance.yaml"]!).models.ciAllowed).to.equal(true);
  });

  it("GOV-FRM-445 a setup answer that differs changes ONLY that key's line — by targeted edit, never a re-render", async () => {
    const { code, files } = await setupOver(ORG_GOV, { checkOwnerGithub: "@dave" });
    expect(code).to.equal(0);
    const before = ORG_GOV.split("\n"), after = files["/repo/policies/governance.yaml"]!.split("\n");
    expect(after.length).to.equal(before.length);
    const changed = before.map((l, i) => [l, after[i]]).filter(([a, b]) => a !== b);
    expect(changed).to.deep.equal([['  github: "@rk"', '  github: "@dave"']]);
    expect(parseGovernance(after.join("\n")).checkOwner.github).to.equal("@dave");
  });

  it("GOV-FRM-445 setup fills an EMPTY value of its own, and touches nothing else", async () => {
    const gov = ORG_GOV.replace('email: "rk@acme.io"', 'email: ""');
    const { files } = await setupOver(gov);
    expect(files["/repo/policies/governance.yaml"]).to.equal(ORG_GOV);
  });

  it("GOV-FRM-445 setup still SEEDS the file when it is absent", async () => {
    const files: Record<string, string> = { "/repo/org-config.yaml": ORG_CONFIG };
    const code = await runSetup({
      fs: memFs(files), cwd: "/repo", originUrl: CTX.originUrl, ghUser: CTX.ghUser, gitEmail: CTX.gitEmail, today: CTX.today,
      existing: readExistingOrgConfig(ORG_CONFIG), prompt: async (_q, d) => d, print: () => {},
    }, false);
    expect(code).to.equal(0);
    expect(parseGovernance(files["/repo/policies/governance.yaml"]!).policyOwner.github).to.equal("@rk");
  });

  describe("gov upgrade --apply", () => {
    let ws: string;
    let home: string;
    beforeEach(() => {
      ws = fs.mkdtempSync(path.join(os.tmpdir(), "gov-445-ws-"));
      home = fs.mkdtempSync(path.join(os.tmpdir(), "gov-445-home-"));
      fs.mkdirSync(path.join(ws, "policies"), { recursive: true });
      fs.writeFileSync(path.join(ws, GOVERNANCE_PATH), ORG_GOV);
    });
    afterEach(() => { fs.rmSync(ws, { recursive: true, force: true }); fs.rmSync(home, { recursive: true, force: true }); });

    it("GOV-FRM-445 leaves the org's governance.yaml byte for byte (a set-up org)", () => {
      fs.writeFileSync(path.join(ws, "org-config.yaml"), ORG_CONFIG);
      const res = runUpgradeSync(CONTENT, ws, { apply: true, userHome: home });
      expect(res.code, res.lines.join("\n")).to.equal(0);
      expect(fs.readFileSync(path.join(ws, GOVERNANCE_PATH), "utf8")).to.equal(ORG_GOV);
    });

    it("GOV-FRM-445 the org-config split leaves it byte for byte when org-config agrees with it", () => {
      fs.writeFileSync(path.join(ws, "org-config.yaml"), `${ORG_CONFIG}\npolicy_owner_github: "@rk"\ngovernance_posture: "soft"\n`);
      const res = runUpgradeSync(CONTENT, ws, { apply: true, userHome: home });
      expect(res.code, res.lines.join("\n")).to.equal(0);
      expect(fs.readFileSync(path.join(ws, GOVERNANCE_PATH), "utf8")).to.equal(ORG_GOV);
    });

    it("GOV-FRM-445 the agents migration never replaces an agent list the org already wrote", () => {
      fs.writeFileSync(path.join(ws, "org-config.yaml"), ORG_CONFIG);
      fs.mkdirSync(path.join(ws, "governance", "policies"), { recursive: true });
      fs.writeFileSync(path.join(ws, "governance", "policies", "llm-governance.md"), "```yaml\napproved_agents:\n  - id: ibm-bob\n    default: true\n```\n");
      runUpgradeSync(CONTENT, ws, { apply: true, userHome: home });
      expect(fs.readFileSync(path.join(ws, GOVERNANCE_PATH), "utf8")).to.equal(ORG_GOV);
    });
  });

  it("GOV-FRM-445 the split never replaces a value the org WROTE, even one equal to the template's default", () => {
    // `soft` is the template's default — but this file is the org's, not the template, so `soft` is their answer.
    const out = splitOrgConfig({ orgConfig: 'org_slug: "ACME"\ngovernance_posture: "hard"\n', governance: ORG_GOV, roleList: null });
    expect(out.governance).to.equal(ORG_GOV);
  });

  it("GOV-FRM-445 gov app setup leaves the org's governance.yaml byte for byte", async () => {
    const files: Record<string, string> = { "/gov/org-config.yaml": 'org_name: "Acme"\ngithub_org: "acme"\nservices:\n  vault: ""\n', "/gov/policies/governance.yaml": ORG_GOV };
    const written: string[] = [];
    const ok = (stdout = ""): GhOutcome => ({ status: 0, stdout, stderr: "" });
    const routes: [RegExp, GhOutcome][] = [
      [/^api \/apps\//, { status: 1, stdout: "", stderr: "gh: Not Found (HTTP 404)" }],
      [/^api \/orgs\/acme --jq \.plan\.name$/, ok("team")],
      [/^api \/repos\/[^ ]+ --jq \.visibility$/, ok("private")],
      [/^api -X POST \/app-manifests\/code123\/conversions$/, ok(JSON.stringify({ id: 1, slug: "gov-acme", client_id: "Iv1", pem: "-----BEGIN RSA PRIVATE KEY-----\nx\n-----END RSA PRIVATE KEY-----\n" }))],
      [/^secret set /, ok()],
    ];
    const gh: GhRun = (args) => routes.find(([re]) => re.test(args.join(" ")))?.[1] ?? { status: 1, stdout: "", stderr: "no route" };
    const deps: AppSetupDeps = {
      gh,
      loopback: async () => ({ url: "http://127.0.0.1:5555/", code: Promise.resolve("code123"), close: () => {} }),
      readFile: (f) => files[px(f)] ?? null,
      writeFile: (f, t) => { written.push(px(f)); files[px(f)] = t; },
      say: () => {},
      newState: () => "st",
    };
    const r = await appSetup(deps, { home: "/gov", githubOrg: "acme", orgSlugLower: "acme", workspaceRepo: "acme-gov", defaultBranch: "main" });
    expect(r.code, r.lines.join("\n")).to.equal(0);
    expect(written).to.not.include("/gov/policies/governance.yaml");
    expect(files["/gov/policies/governance.yaml"]).to.equal(ORG_GOV);
  });
});

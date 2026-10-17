// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * Where an Actions secret has to live for a repository's workflow to receive it (rule-model-design.md, "secrets on
 * Free + private"). SANDBOX FINDING (svayam-e2e, 2026-10-07): on GitHub Free an ORGANIZATION secret is not given to
 * a PRIVATE repository — the job sees an empty value, with no warning.
 */
import { expect } from "chai";
import {
  checkSecretNeeds, keyNameFor, readPlan, readReach, readVisibility, secretReach, writeSecrets,
  type PlanFact, type RepoFact,
} from "../../src/cli/secret-reach.js";
import type { GhOutcome, GhRun } from "../../src/cli/app-verb.js";

const ok = (stdout = ""): GhOutcome => ({ status: 0, stdout, stderr: "" });
const err = (stderr: string): GhOutcome => ({ status: 1, stdout: "", stderr });
interface Call { args: readonly string[]; input?: string }
function fakeGh(routes: [RegExp, GhOutcome][], calls: Call[] = []): GhRun {
  return (args, input) => {
    calls.push({ args, ...(input === undefined ? {} : { input }) });
    return routes.find(([re]) => re.test(args.join(" ")))?.[1] ?? err("no route");
  };
}

const FREE: PlanFact = { known: true, name: "free" };
const TEAM: PlanFact = { known: true, name: "team" };
const UNKNOWN: PlanFact = { known: false, why: "only an org owner can see the plan" };
const pub: RepoFact = { repo: "acme/site", visibility: "public" };
const priv: RepoFact = { repo: "acme/app", visibility: "private" };
const internal: RepoFact = { repo: "acme/inner", visibility: "internal" };
const unseen: RepoFact = { repo: "acme/ghost", visibility: null, why: "HTTP 404" };

describe("secretReach — the one rule: org secrets reach a repo on a paid plan, or a public repo", () => {
  it("Free + private (or internal) → the repo needs repository secrets", () => {
    expect(secretReach(FREE, [priv, internal]).map((r) => r.reach)).to.deep.equal(["repo-required", "repo-required"]);
  });

  it("Free + public → org; paid + anything → org", () => {
    expect(secretReach(FREE, [pub])[0]!.reach).to.equal("org");
    expect(secretReach(TEAM, [priv, pub, internal]).map((r) => r.reach)).to.deep.equal(["org", "org", "org"]);
    expect(secretReach({ known: true, name: "enterprise" }, [priv])[0]!.reach).to.equal("org");
  });

  it("an unknown plan is NEVER assumed: private → cannot-tell; public still reaches", () => {
    const r = secretReach(UNKNOWN, [priv, pub]);
    expect(r.map((x) => x.reach)).to.deep.equal(["cannot-tell", "org"]);
    expect(r[0]!.why).to.contain("org owner");
  });

  it("a plan name gov does not know is not assumed paid", () => {
    expect(secretReach({ known: true, name: "mystery" }, [priv])[0]!.reach).to.equal("cannot-tell");
  });

  it("an unseen visibility is cannot-tell on Free, and org on a paid plan (the plan alone decides)", () => {
    expect(secretReach(FREE, [unseen])[0]!.reach).to.equal("cannot-tell");
    expect(secretReach(TEAM, [unseen])[0]!.reach).to.equal("org");
  });

  it("is pure: same facts, same answer, one row per repo in order", () => {
    expect(secretReach(FREE, [priv, pub])).to.deep.equal(secretReach(FREE, [priv, pub]));
    expect(secretReach(FREE, [priv, pub]).map((r) => r.repo)).to.deep.equal(["acme/app", "acme/site"]);
  });
});

describe("reading the facts through gh", () => {
  it("the plan comes from `gh api /orgs/{org}` plan.name; empty (not an owner) is cannot-tell", () => {
    expect(readPlan(fakeGh([[/^api \/orgs\/acme --jq \.plan\.name$/, ok("free\n")]]), "acme")).to.deep.equal(FREE);
    const blank = readPlan(fakeGh([[/^api \/orgs\/acme/, ok("\n")]]), "acme");
    expect(blank.known).to.equal(false);
    expect(!blank.known && blank.why).to.contain("org owner");
    expect(readPlan(fakeGh([[/^api \/orgs\/acme/, err("HTTP 403")]]), "acme").known).to.equal(false);
  });

  it("visibility comes from `gh api /repos/{o}/{r}`; a failure is null with the reason", () => {
    expect(readVisibility(fakeGh([[/^api \/repos\/acme\/app --jq \.visibility$/, ok("private\n")]]), "acme/app")).to.deep.equal(priv);
    const r = readVisibility(fakeGh([[/./, err("gh: Not Found (HTTP 404)")]]), "acme/app");
    expect(r.visibility).to.equal(null);
    expect(r.why).to.contain("404");
  });

  it("readReach asks for the plan once and each repo once", () => {
    const calls: Call[] = [];
    const gh = fakeGh([[/^api \/orgs\/acme/, ok("free")], [/^api \/repos\/acme\/app/, ok("private")], [/^api \/repos\/acme\/site/, ok("public")]], calls);
    const r = readReach(gh, "acme", ["acme/app", "acme/site", "acme/app"]);
    expect(r.reaches.map((x) => `${x.repo}:${x.reach}`)).to.deep.equal(["acme/app:repo-required", "acme/site:org"]);
    expect(calls).to.have.length(3);
  });
});

describe("writeSecrets — org where it reaches, the repository where it must, values on STDIN only", () => {
  const VALUES = [{ name: "GOV_APP_CLIENT_ID", value: "Iv1" }, { name: "GOV_APP_PRIVATE_KEY", value: "PEMSECRET" }];

  it("Free + one private, one public: org secrets for the public one, repository secrets on the private one", () => {
    const calls: Call[] = [];
    const out = writeSecrets(fakeGh([[/^secret set /, ok()]], calls), "acme", secretReach(FREE, [priv, pub]), VALUES);
    expect(out.failed).to.equal(false);
    expect(calls.map((c) => c.args.join(" "))).to.deep.equal([
      "secret set GOV_APP_CLIENT_ID --org acme --visibility all",
      "secret set GOV_APP_PRIVATE_KEY --org acme --visibility all",
      "secret set GOV_APP_CLIENT_ID -R acme/app",
      "secret set GOV_APP_PRIVATE_KEY -R acme/app",
    ]);
    expect(calls.map((c) => c.input)).to.deep.equal(["Iv1", "PEMSECRET", "Iv1", "PEMSECRET"]);
    expect(out.lines.join("\n")).to.contain("acme/app").and.not.contain("PEMSECRET");
  });

  it("Free + only private repos: no org secret (it would reach none of them), and says why", () => {
    const calls: Call[] = [];
    const out = writeSecrets(fakeGh([[/^secret set /, ok()]], calls), "acme", secretReach(FREE, [priv]), VALUES);
    expect(calls.every((c) => c.args.includes("-R"))).to.equal(true);
    expect(out.lines.join("\n")).to.contain("Free plan");
  });

  it("cannot-tell: writes BOTH, because a repository secret always reaches — and says gov could not tell", () => {
    const calls: Call[] = [];
    const out = writeSecrets(fakeGh([[/^secret set /, ok()]], calls), "acme", secretReach(UNKNOWN, [priv]), VALUES);
    expect(calls.map((c) => c.args.join(" "))).to.include("secret set GOV_APP_PRIVATE_KEY --org acme --visibility all")
      .and.include("secret set GOV_APP_PRIVATE_KEY -R acme/app");
    expect(out.lines.join("\n")).to.contain("could not tell");
  });

  it("a repo that refuses: failed, the rest still written, and the fix names `gov app rotate` — never the value", () => {
    const calls: Call[] = [];
    const out = writeSecrets(fakeGh([[/-R acme\/app$/, err("HTTP 403: Must have admin rights")], [/^secret set /, ok()]], calls),
      "acme", secretReach(FREE, [priv, { repo: "acme/two", visibility: "private" }]), VALUES);
    expect(out.failed).to.equal(true);
    expect(calls.some((c) => c.args.join(" ") === "secret set GOV_APP_PRIVATE_KEY -R acme/two")).to.equal(true);
    const text = out.lines.join("\n");
    expect(text).to.contain("acme/app").and.contain("gov app rotate").and.not.contain("PEMSECRET");
  });
});

describe("checkSecretNeeds — which repo will NOT receive a secret it needs, with the exact fix", () => {
  const routes = (over: [RegExp, GhOutcome][] = []): [RegExp, GhOutcome][] => [
    ...over,
    [/^api \/orgs\/acme --jq/, ok("free")],
    [/^api \/repos\/acme\/app --jq/, ok("private")],
    [/^api \/repos\/acme\/site --jq/, ok("public")],
    [/^secret list -R acme\/app/, ok("[]")],
    [/^secret list -R acme\/site/, ok("[]")],
  ];

  it("Free + private, repository secret missing → ✗ naming the repo and the fix", () => {
    const r = checkSecretNeeds(fakeGh(routes()), "acme", [{ repo: "acme/app", name: "GOV_APP_PRIVATE_KEY", fix: "gov app rotate" }], ["GOV_APP_PRIVATE_KEY"]);
    expect(r.fail).to.have.length(1);
    expect(r.fail[0]).to.contain("acme/app").and.contain("GOV_APP_PRIVATE_KEY").and.contain("gov app rotate").and.contain("Free");
  });

  it("Free + private with the repository secret set → ✓", () => {
    const r = checkSecretNeeds(fakeGh(routes([[/^secret list -R acme\/app/, ok('[{"name":"GOV_APP_PRIVATE_KEY"}]')]])), "acme",
      [{ repo: "acme/app", name: "GOV_APP_PRIVATE_KEY", fix: "gov app rotate" }], []);
    expect(r.fail).to.deep.equal([]);
    expect(r.pass.join("\n")).to.contain("acme/app");
  });

  it("a public repo is reached by the org secret when it is set; not set → ✗", () => {
    const need = [{ repo: "acme/site", name: "GEMINI_API_KEY", fix: "gh secret set GEMINI_API_KEY -R acme/site" }];
    expect(checkSecretNeeds(fakeGh(routes()), "acme", need, ["GEMINI_API_KEY"]).fail).to.deep.equal([]);
    expect(checkSecretNeeds(fakeGh(routes()), "acme", need, []).fail[0]).to.contain("gh secret set GEMINI_API_KEY -R acme/site");
  });

  it("the plan unseen and no repository secret → cannot tell, never ok", () => {
    const r = checkSecretNeeds(fakeGh(routes([[/^api \/orgs\/acme --jq/, ok("")]])), "acme",
      [{ repo: "acme/app", name: "GOV_APP_PRIVATE_KEY", fix: "gov app rotate" }], ["GOV_APP_PRIVATE_KEY"]);
    expect(r.fail).to.deep.equal([]);
    expect(r.unsure.join("\n")).to.contain("acme/app").and.contain("org owner");
  });

  it("org secrets unreadable (null) is cannot-tell for an org-reached repo", () => {
    const r = checkSecretNeeds(fakeGh(routes()), "acme", [{ repo: "acme/site", name: "X", fix: "f" }], null);
    expect(r.unsure).to.have.length(1);
  });
});

describe("keyNameFor — the approved model's key, needed by the gov repo only when CI may use it", () => {
  it("anthropic / gemini name their key when ci_allowed; command or not allowed → none", () => {
    expect(keyNameFor({ provider: "anthropic", model: "m", command: "", ciAllowed: true })).to.equal("ANTHROPIC_API_KEY");
    expect(keyNameFor({ provider: "gemini", model: "m", command: "", ciAllowed: true })).to.equal("GEMINI_API_KEY");
    expect(keyNameFor({ provider: "gemini", model: "m", command: "", ciAllowed: false })).to.equal(null);
    expect(keyNameFor({ provider: "command", model: "", command: "x", ciAllowed: true })).to.equal(null);
    expect(keyNameFor({ provider: null, model: "", command: "", ciAllowed: true })).to.equal(null);
  });
});

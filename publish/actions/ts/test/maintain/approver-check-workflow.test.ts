// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
//
// THE APPROVER CHECK'S OWN SCRIPT, RUN (GOV-FRM-447; alternates F143 A, solo mode Q45 C — Policy Owner rulings of
// 2026-11-23). The workflow reads governance.yaml and the role list itself, in awk, so it is tested by running it:
// the `run:` block of the shipped template, in a scratch governance repository, with a `gh` on PATH that answers the
// one reviews call it makes.
import { expect } from "chai";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { spawnSync } from "node:child_process";
import yaml from "js-yaml";
import { approverLogins } from "../../src/maintain/repo-protect.js";

const CONTENT = path.join(import.meta.dirname, "..", "..", "..", "..", "content");
const WORKFLOW = path.join(CONTENT, "framework", "build", "templates", "workflows", "approver-check.yml");
const SCRIPT = (() => {
  const doc = yaml.load(fs.readFileSync(WORKFLOW, "utf8")) as { jobs: Record<string, { steps: { run?: string }[] }> };
  return doc.jobs["approver-check"]!.steps.find((s) => s.run)!.run!;
})();

const APPROVER_LOGINS = "approverLogins (the GOV_APPROVERS line gov prints) carries the alternates too";
const ROLES_OLD = "| Role | GitHub handle | Owns |\n|---|---|---|\n| Data Owner | @dana | `knowledge/data/` |\n";
const ROLES_ALT = "| Role | GitHub handle | Owns | Alternate |\n|---|---|---|---|\n| Data Owner | @dana | `knowledge/data/` | @dev |\n";
const gov = (posture: string, po: string, poAlt = "", co = "") =>
  `governance_posture: "${posture}"\npolicy_owner:\n  email: ""\n  github: "${po}"\n  alternate: "${poAlt}"\ncheck_owner:\n  github: "${co}"\n  alternate: ""\n`;

interface Review { readonly state: string; readonly user: { readonly login: string } | null; readonly submitted_at: string | null }

/**
 * A `gh` that answers the reviews call AS gh DOES (F153 A): `--paginate` serves the reviews in pages of PAGE, and
 * `--jq <filter>` is applied to each page separately and prints strings raw — gh's embedded gojq, stood in for by
 * the real jq with `-r`. The workflow itself no longer runs jq; only this stub does.
 */
const PAGE = 2;
function ghStub(dir: string, reviews: readonly Review[]): void {
  const pages = path.join(dir, "pages");
  fs.mkdirSync(pages);
  const n = Math.max(1, Math.ceil(reviews.length / PAGE));
  for (let i = 0; i < n; i++) fs.writeFileSync(path.join(pages, `${i}.json`), JSON.stringify(reviews.slice(i * PAGE, (i + 1) * PAGE)));
  fs.writeFileSync(path.join(dir, "bin", "gh"), [
    "#!/bin/sh",
    'filter=""',
    'while [ $# -gt 0 ]; do [ "$1" = "--jq" ] && { filter="$2"; shift; }; shift; done',
    `for p in "${pages}"/*.json; do if [ -n "$filter" ]; then jq -r "$filter" "$p" || exit 1; else cat "$p"; fi; done`,
    "",
  ].join("\n"), { mode: 0o755 });
}

function runWith(files: { governance: string; roles?: string }, author: string, reviews: readonly Review[], approvers = ""): { code: number; out: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "approver-check-"));
  try {
    fs.mkdirSync(path.join(dir, "policies", "common"), { recursive: true });
    fs.mkdirSync(path.join(dir, "bin"));
    fs.writeFileSync(path.join(dir, "policies", "governance.yaml"), files.governance);
    if (files.roles) fs.writeFileSync(path.join(dir, "policies", "common", "authorized-representatives.md"), files.roles);
    ghStub(dir, reviews);
    // From a file, as GitHub runs a step — not `bash -c`: Windows argv quoting mangles a script this size.
    fs.writeFileSync(path.join(dir, "step.sh"), SCRIPT);
    const r = spawnSync("bash", ["step.sh"], {
      cwd: dir, encoding: "utf8",
      env: { PATH: `${path.join(dir, "bin")}:${process.env.PATH}`, REPO: "acme/acme-gov", PR: "7", AUTHOR: author, GH_TOKEN: "x", GOV_APPROVERS: approvers },
    });
    return { code: r.status ?? -1, out: `${r.stdout}${r.stderr}` };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function run(files: { governance: string; roles?: string }, author: string, approvedBy: readonly string[]): { code: number; out: string } {
  return runWith(files, author, approvedBy.map((login, i) => ({ state: "APPROVED", user: { login }, submitted_at: `2026-11-23T10:0${i}:00Z` })));
}

/** The TEST needs bash, and jq to stand in for gh's embedded one (the workflow needs neither jq nor python); a machine
 * without either skips (not a pass). */
const hasTools = ["bash", "jq"].every((t) => spawnSync(t, ["--version"], { encoding: "utf8" }).status === 0);

describe("approver-check workflow — alternates and solo mode (F143 A, Q45 C)", function () {
  beforeEach(function () { if (!hasTools && this.currentTest?.title !== APPROVER_LOGINS) this.skip(); });
  it("the Policy Owner's alternate (governance.yaml) is an authorized representative", () => {
    const r = run({ governance: gov("soft", "polly", "@pat"), roles: ROLES_OLD }, "polly", ["pat"]);
    expect(r.code, r.out).to.equal(0);
    expect(r.out).to.contain("approved by pat");
  });

  it("a role's alternate from the Alternate column is an authorized representative", () => {
    const r = run({ governance: gov("soft", "polly"), roles: ROLES_ALT }, "dana", ["dev"]);
    expect(r.code, r.out).to.equal(0);
  });

  it("an old role table without the column still lists its holders", () => {
    const r = run({ governance: gov("soft", "polly"), roles: ROLES_OLD }, "polly", ["dana"]);
    expect(r.code, r.out).to.equal(0);
  });

  it("a flow-form block's alternate is read too", () => {
    const r = run({ governance: 'governance_posture: soft\npolicy_owner: { github: "polly", alternate: "pat" }\n' }, "polly", ["pat"]);
    expect(r.code, r.out).to.equal(0);
  });

  it("Q46 A: a vacant Policy Owner's alternate is an authorized representative — the list is not empty, and they approve", () => {
    const r = run({ governance: gov("soft", "", "pat", "chuck") }, "chuck", ["pat"]);
    expect(r.code, r.out).to.equal(0);
    expect(r.out).to.contain("approved by pat");
  });

  it("Q46 A: a vacant Check Owner's alternate approves", () => {
    const r = run({ governance: gov("hard", "polly").replace('check_owner:\n  github: ""\n  alternate: ""', 'check_owner:\n  github: ""\n  alternate: "cora"') }, "polly", ["cora"]);
    expect(r.code, r.out).to.equal(0);
  });

  it("SOFT, nobody but the author holds a role or alternate: still fails, saying self-merged: no second person", () => {
    const r = run({ governance: gov("soft", "solo"), roles: "| Role | GitHub handle | Owns | Alternate |\n|---|---|---|---|\n| Data Owner | vacant | — | |\n" }, "solo", []);
    expect(r.code).to.equal(1);
    expect(r.out).to.contain("self-merged: no second person").and.contain("solo mode");
  });

  it("HARD, the same: nothing changes — the plain missing-approval failure", () => {
    const r = run({ governance: gov("hard", "solo") }, "solo", []);
    expect(r.code).to.equal(1);
    expect(r.out).to.not.contain("self-merged");
    expect(r.out).to.contain("No approving review yet");
  });

  it("a role written `vacant` names nobody: a login called vacant is not an authorized representative", () => {
    const r = run({ governance: gov("hard", "polly"), roles: "| Role | GitHub handle | Owns | Alternate |\n|---|---|---|---|\n| Data Owner | vacant | — | none |\n" }, "dana", ["vacant", "none"]);
    expect(r.code).to.equal(1);
    expect(r.out).to.contain("none of them is on");
  });

  it("SOFT with an alternate named: not solo — the plain missing-approval failure", () => {
    const r = run({ governance: gov("soft", "solo", "pat") }, "solo", []);
    expect(r.code).to.equal(1);
    expect(r.out).to.not.contain("self-merged");
  });

  it(APPROVER_LOGINS, () => {
    expect(approverLogins(gov("soft", "polly", "@pat", "chuck"), ROLES_ALT)).to.deep.equal(["polly", "pat", "chuck", "dana", "dev"]);
  });
});

// POLICY OWNER RULING F163 B (PRJ-121, 2026-11-25): a role's list is its holder plus any number of alternates; anyone
// on any list, other than the author, is an authorized representative. Every form governance.yaml can write it in.
describe("approver-check workflow — several alternates per role (F163 B)", function () {
  beforeEach(function () { if (!hasTools && !this.currentTest?.title.startsWith("approverLogins")) this.skip(); });
  const head = 'governance_posture: "hard"\n';
  const forms: [string, string][] = [
    ["a single string, as every file before F163 (e.g. a proposal adding one alternate)", 'policy_owner:\n  github: "polly"\n  alternate: "princy1511"\n'],
    ["a flow list", 'policy_owner:\n  github: "polly"\n  alternate: ["ana", "princy1511"]\n'],
    ["a block list", "policy_owner:\n  github: polly\n  alternate:\n    - ana\n    - princy1511   # the second\n"],
    ["the `alternates:` spelling", "policy_owner:\n  github: polly\n  alternates: [ana, '@princy1511']\n"],
    ["a comma-separated string", 'policy_owner:\n  github: "polly"\n  alternate: "ana, princy1511"\n'],
    ["the flow form of the whole block", "policy_owner: { github: polly, email: a@b.example, alternate: [ana, princy1511] }\n"],
  ];
  for (const [what, yamlText] of forms) {
    it(`governance.yaml, ${what}: every alternate is listed, and one of them approving passes`, () => {
      const r = run({ governance: `${head}${yamlText}check_owner:\n  github: chuck\n` }, "polly", ["princy1511"]);
      expect(r.code, r.out).to.equal(0);
      expect(r.out).to.contain("approved by princy1511");
      expect(r.out).to.not.match(/^\s+(a@b\.example|email|github|alternates?)$/m);
    });
  }

  it("the Alternate column with several handles, comma-separated: any one of them approves", () => {
    const roles = "| Role | GitHub handle | Owns | Alternate |\n|---|---|---|---|\n| Data Owner | @dana | `knowledge/data/` | @dev, `@dee` lee |\n";
    for (const who of ["dev", "dee", "lee"]) {
      const r = run({ governance: gov("hard", "polly"), roles }, "dana", [who]);
      expect(r.code, r.out).to.equal(0);
    }
  });

  it("the author is on the list but their own approval never counts", () => {
    const r = run({ governance: `${head}policy_owner:\n  github: polly\n  alternate: [ana, ben]\n` }, "ana", ["ana"]);
    expect(r.code).to.equal(1);
  });

  it("approverLogins (the GOV_APPROVERS line) carries every alternate, from both forms", () => {
    expect(approverLogins(`${head}policy_owner:\n  github: polly\n  alternate: [ana, ben]\ncheck_owner:\n  github: chuck\n  alternates: cy\n`,
      "| Role | GitHub handle | Owns | Alternate |\n|---|---|---|---|\n| Data Owner | @dana | — | @dev, @dee |\n"))
      .to.deep.equal(["polly", "ana", "ben", "chuck", "cy", "dana", "dev", "dee"]);
  });
});

// ── F153 A (Policy Owner, 2026-11-24): no installed workflow runs jq ─────────────────────────────────────────────
// A bare self-hosted runner without jq killed the approver check with exit 127. The filter now runs inside the gh
// call (`--jq`, gh's embedded gojq) and the per-reviewer grouping in sort and awk.

/** The jq filter the approver check ran before F153 A, verbatim — the reference the new pipeline must agree with. */
const PRE_F153_FILTER = `
  [ .[] | select(.state == "APPROVED" or .state == "CHANGES_REQUESTED" or .state == "DISMISSED") ]
  | group_by(.user.login)
  | map(sort_by(.submitted_at) | last)
  | map(select(.state == "APPROVED") | .user.login | ascii_downcase)
  | unique | .[]
`;
const FIXTURE = path.join(import.meta.dirname, "fixtures", "approver-check", "reviews.json");

/** A line that runs jq as a command: `jq` as a word, not gh's `--jq` flag, outside a comment. */
const invokesJq = (text: string): string[] =>
  text.split("\n").filter((l) => !/^\s*#/.test(l) && /(^|[^-\w])jq(\s|$|["')])/.test(l));

describe("approver-check — no jq on the runner (F153 A)", function () {
  it("no workflow gov installs invokes jq: the templates, gov-validate.yml, and both files the setup commit writes", async () => {
    const { firstRunWorkflows } = await import("../../src/setup/first-run-workflows.js");
    const { fsTree } = await import("../../src/rules/policy-pr/tree.js");
    const dir = path.join(CONTENT, "framework", "build", "templates", "workflows");
    const texts: [string, string][] = fs.readdirSync(dir).map((f) => [f, fs.readFileSync(path.join(dir, f), "utf8")]);
    // gov-validate.yml: installed once into the governance repository (spec 9.5), so it counts too.
    const validate = path.join(CONTENT, ".github", "workflows", "gov-validate.yml");
    texts.push(["gov-validate.yml", fs.readFileSync(validate, "utf8")]);
    const t = fsTree(CONTENT);
    const tree = { files: (d: string) => [...t.files(d), ...(d === "org-config.yaml" ? ["org-config.yaml"] : [])], read: (f: string) => (f === "org-config.yaml" ? 'org_slug: "acme"\ngithub_org: "acme"\n' : t.read(f)) };
    const r = firstRunWorkflows(tree, { home: CONTENT, defaultBranch: "main", defaultCodeBranch: "main", githubOrg: "acme", workspaceRepo: "acme-gov", posture: "soft" });
    expect(r.ok, r.ok ? "" : r.reason).to.equal(true);
    if (r.ok) for (const f of r.files) texts.push([f.path, f.text]);
    expect(texts.length).to.be.greaterThan(3);
    for (const [name, text] of texts) expect(invokesJq(text), name).to.deep.equal([]);
    expect(SCRIPT).to.contain("--jq");
  });

  it("the check catches a jq invocation (so the assertion above can fail)", () => {
    expect(invokesJq('  x="$(printf %s "$j" | jq -r .a)"')).to.have.length(1);
    expect(invokesJq("  gh api user --jq .login\n  # no jq here")).to.deep.equal([]);
  });

  it("on a recorded reviews fixture, split across pages, the approvers equal what the pre-F153 jq filter gave", function () {
    if (!hasTools) this.skip();
    const reviews = JSON.parse(fs.readFileSync(FIXTURE, "utf8")) as Review[];
    const ref = spawnSync("jq", ["-r", PRE_F153_FILTER, FIXTURE], { encoding: "utf8" });
    expect(ref.status, ref.stderr).to.equal(0);
    const author = "polly";
    const expected = ref.stdout.split(/\r?\n/).filter((l) => l && l !== author);
    // withdrawn (dana), dismissed (chuck), commented-after (cora counts), equal times (dev), pending (erin counts)
    expect(expected).to.deep.equal(["cora", "dev", "erin", "pat"]);
    const r = runWith({ governance: gov("soft", "polly") }, author, reviews, expected.join(" "));
    expect(r.code, r.out).to.equal(0);
    const listed = r.out.split("Approving reviewers:\n")[1]!.split("✓")[0]!.split("\n").map((l) => l.trim()).filter(Boolean);
    expect(listed).to.deep.equal(expected);
  });

  it("a withdrawn approval on a later page does not count", function () {
    if (!hasTools) this.skip();
    const reviews: Review[] = [
      { state: "APPROVED", user: { login: "dana" }, submitted_at: "2026-11-23T10:00:00Z" },
      { state: "COMMENTED", user: { login: "x" }, submitted_at: "2026-11-23T10:01:00Z" },
      { state: "CHANGES_REQUESTED", user: { login: "dana" }, submitted_at: "2026-11-23T10:02:00Z" },
    ];
    const r = runWith({ governance: gov("hard", "polly") }, "polly", reviews, "dana");
    expect(r.code).to.equal(1);
    expect(r.out).to.contain("No approving review yet");
  });
});

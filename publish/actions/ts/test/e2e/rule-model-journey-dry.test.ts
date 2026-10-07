// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * THE RULE-MODEL JOURNEY'S DRY RUN (e2e/rule-model-journey.sh --dry-run). The live journey runs only in CI against
 * the sandbox org, so a typo in it would surface twenty minutes into a real run. The dry run walks every step and
 * prints each gh / git / gov / npm / curl call instead of making it; this test proves that it does walk every step,
 * that it touches NOTHING outside (each of those programs is a trap on PATH here), and that no secret reaches the
 * printed calls.
 */
import { expect } from "chai";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const SCRIPT = path.resolve(import.meta.dirname, "../../e2e/rule-model-journey.sh");
const TRAPPED = ["gh", "git", "gov", "npm", "curl", "openssl"];

describe("e2e/rule-model-journey.sh --dry-run", function () {
  this.timeout(30_000);
  if (process.platform === "win32") return; // a bash script; the live tier runs on ubuntu

  let dir: string;
  let out: string;
  let status: number | null;
  const trapLog = (): string => (fs.existsSync(path.join(dir, "called.log")) ? fs.readFileSync(path.join(dir, "called.log"), "utf8") : "");

  before(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "rmj-dry-"));
    const bin = path.join(dir, "bin");
    fs.mkdirSync(bin);
    for (const p of TRAPPED) {
      fs.writeFileSync(path.join(bin, p), `#!/usr/bin/env bash\necho "${p} $*" >> "${path.join(dir, "called.log")}"\nexit 97\n`, { mode: 0o755 });
    }
    const env: NodeJS.ProcessEnv = { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH ?? ""}`, E2E_APP_CLIENT_ID: "app-id-SECRET", E2E_APP_PRIVATE_KEY: "pem-SECRET", GEMINI_API_KEY: "gem-SECRET" };
    delete env.GH_TOKEN; delete env.GITHUB_ACTIONS; delete env.E2E_ORG; delete env.GOV_TARBALL;
    const r = spawnSync("bash", [SCRIPT, "--dry-run"], { env, encoding: "utf8" });
    status = r.status;
    out = `${r.stdout}${r.stderr}`;
  });
  after(() => fs.rmSync(dir, { recursive: true, force: true }));

  it("walks to the end and exits 0", () => {
    expect(status, out).to.equal(0);
    expect(out).to.match(/rule-model-journey \(DRY RUN\): \d+ passed, 0 skipped, ok/);
  });

  it("calls nothing outside — every program it would run is only printed", () => {
    expect(trapLog()).to.equal("");
  });

  it("lists every assertion, (a) through (f)", () => {
    for (const a of ["(a) GOV-FRM-455", "(a) GOV-FRM-467", "(a) GOV-FRM-468", "(b) gov-violation issue", "(c) GOV-FRM-467 names the section unreviewed",
      "(c) GOV-FRM-468 ran propose", "(d) GOV-FRM-467 passes", "(e) gov-violation record", "(f) the code repo judged"]) {
      expect(out, a).to.include(`would assert: ${a}`);
    }
  });

  it("prints the calls that matter: ephemeral repos, the tarball, the stub model, the approval, teardown", () => {
    expect(out).to.match(/\+ gh repo create \S+\/rmj-dry-gov --private/);
    expect(out).to.match(/\+ gh repo create \S+\/rmj-dry-app --private/);
    expect(out).to.include("+ gov upgrade --apply --from ");
    expect(out).to.include("+ gov check install --gov-package ./.gov-ci/gov.tgz --gov-home .");
    expect(out).to.match(/\+ gh api -X POST repos\/\S+\/actions\/runs\/\S+\/approve/);
    expect(out).to.match(/\+ gh repo delete \S+\/rmj-dry-gov --yes/);
    expect(out).to.match(/\+ gh repo delete \S+\/rmj-dry-app --yes/);
  });

  it("checks the token's scopes at START, before it creates anything it may not be able to delete", () => {
    const at = out.indexOf("+ gh api -i user");
    expect(at, "the scope check runs").to.be.greaterThan(-1);
    expect(at, "before the repos are created").to.be.lessThan(out.indexOf("+ gh repo create"));
    expect(out, "the dry run's token has delete_repo").to.not.include("delete_repo scope");
  });

  it("never prints a secret's value — they go on stdin", () => {
    expect(out).to.not.include("SECRET");
    expect(out).to.include("gh secret set GOV_APP_PRIVATE_KEY");
  });
});

// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
//
// `gov evidence verify` inside the gov repo reads the `gov/evidence` branch through git — no checkout of it, no fetch —
// and leaves no temporary copy behind. A folder with `evidence/` at its top is read directly.
import { expect } from "chai";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { ledgerSourceAt } from "../../src/cli/evidence-run.js";
import { verifyLedger } from "../../src/evidence/verify.js";
import { buildLedger, record, type Ledger } from "../helpers/ledger-fixture.js";

const git = (cwd: string, ...args: string[]): string => execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

describe("gov evidence verify — where the ledger is read from", function () {
  this.timeout(30_000);
  let l: Ledger;
  let repo = "";
  beforeEach(() => {
    l = buildLedger([{ date: "2026/10/30", name: "ci-77-1-1", records: [record(1)] }]);
    repo = fs.mkdtempSync(path.join(os.tmpdir(), "gov-evrepo-"));
    git(repo, "init", "-q", "-b", "main");
    git(repo, "config", "user.email", "t@example.com"); git(repo, "config", "user.name", "t");
    fs.writeFileSync(path.join(repo, "README.md"), "gov repo\n");
    git(repo, "add", "."); git(repo, "commit", "-qm", "init");
  });
  afterEach(() => { l.cleanup(); fs.rmSync(repo, { recursive: true, force: true }); });

  it("a folder with evidence/ at its top is read as it is", () => {
    const s = ledgerSourceAt(l.dir);
    expect(s.ok).to.equal(true);
    if (s.ok) expect(verifyLedger(s.src, { roots: [{ kid: l.root.kid, ...l.root.jwk }] }).ok).to.equal(true);
  });

  it("the gov repo's gov/evidence branch is read through git, the default branch untouched, the temp copy removed", () => {
    git(repo, "checkout", "-q", "--orphan", "gov/evidence");
    git(repo, "rm", "-rqf", ".");
    fs.cpSync(path.join(l.dir, "evidence"), path.join(repo, "evidence"), { recursive: true });
    git(repo, "add", "."); git(repo, "commit", "-qm", "evidence");
    git(repo, "checkout", "-q", "main");
    expect(fs.existsSync(path.join(repo, "evidence"))).to.equal(false);

    const s = ledgerSourceAt(repo);
    expect(s.ok, s.ok ? "" : s.line).to.equal(true);
    if (!s.ok) return;
    expect(s.src.where).to.match(/@ gov\/evidence$/);
    const r = verifyLedger(s.src, { roots: [{ kid: l.root.kid, ...l.root.jwk }] });
    expect(r.ok).to.equal(true);
    expect(r.counts.entries).to.equal(1);
    expect(s.src.list()).to.not.be.empty;
    s.cleanup?.();
    expect(s.src.list()).to.deep.equal([]);
    expect(git(repo, "rev-parse", "--abbrev-ref", "HEAD").trim()).to.equal("main");
  });

  it("no evidence/ and no branch → a plain line naming the fetch to run", () => {
    const s = ledgerSourceAt(repo);
    expect(s.ok).to.equal(false);
    if (!s.ok) expect(s.line).to.match(/git -C .* fetch origin gov\/evidence/);
  });
});

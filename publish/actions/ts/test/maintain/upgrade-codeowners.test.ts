// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * `gov upgrade` REGENERATES CODEOWNERS (GOV-FRM-083). The role list is the org's (policies/authorized-representatives.md),
 * so a holder changes by a pull request to that file; CODEOWNERS follows on the next upgrade — the command doctor's
 * drift row tells the org to run. Tested over the REAL shipped content, applied to a temporary directory.
 */
import { expect } from "chai";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { runUpgradeSync } from "../../src/maintain/upgrade-run.js";
import { expectedCodeowners, codeownersDiagnostic } from "../../src/maintain/roles-health.js";
import { ROLE_LIST_PATH } from "../../src/config/role-list.js";

const contentDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../content");

describe("gov upgrade — CODEOWNERS follows the role list", function () {
  this.timeout(30000);
  let dir = "";
  const read = (rel: string): string | null => {
    const p = path.join(dir, rel);
    return fs.existsSync(p) ? fs.readFileSync(p, "utf8") : null;
  };

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "gov-codeowners-"));
    const r = runUpgradeSync(contentDir, dir, { apply: true });
    expect(r.code, r.lines.join("\n")).to.equal(0);
    // The org's own answers, as setup would have written them, and a role list the org has edited.
    const cfg = read("org-config.yaml")!
      .replace(/^policy_owner_github: ""$/m, 'policy_owner_github: "@polly"')
      .replace(/^check_owner_github: ""$/m, 'check_owner_github: "@chuck"');
    fs.writeFileSync(path.join(dir, "org-config.yaml"), cfg);
    const list = read(ROLE_LIST_PATH)!.replace(/^\| Data Architecture Owner \| <DATA_ARCH_OWNER_GITHUB> \|.*$/m,
      "| Data Owner | @dana | `knowledge/data/` |");
    fs.writeFileSync(path.join(dir, ROLE_LIST_PATH), list);
  });
  afterEach(() => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* gone */ } });

  it("GOV-FRM-083 gov upgrade --apply regenerates a drifted CODEOWNERS from org-config and the role list", () => {
    fs.writeFileSync(path.join(dir, "CODEOWNERS"), "/knowledge/data/ @mallory\n");
    const cfg = read("org-config.yaml")!, list = read(ROLE_LIST_PATH)!;
    expect(codeownersDiagnostic(cfg, list, read("CODEOWNERS"))!.status, "drifted before").to.equal("warn");

    const r = runUpgradeSync(contentDir, dir, { apply: true });
    expect(r.code, r.lines.join("\n")).to.equal(0);
    expect(read("CODEOWNERS")).to.equal(expectedCodeowners(cfg, list));
    expect(read("CODEOWNERS")).to.match(/^\/knowledge\/data\/\s+@dana$/m);
    expect(r.lines.join("\n")).to.match(/CODEOWNERS/);
    expect(codeownersDiagnostic(cfg, list, read("CODEOWNERS"))!.status, "matches after").to.equal("ok");
  });

  it("a dry run writes nothing; a CODEOWNERS that already matches is left alone, byte for byte", () => {
    fs.writeFileSync(path.join(dir, "CODEOWNERS"), "/x @mallory\n");
    runUpgradeSync(contentDir, dir, { apply: false });
    expect(read("CODEOWNERS")).to.equal("/x @mallory\n");

    runUpgradeSync(contentDir, dir, { apply: true });
    const once = read("CODEOWNERS");
    const again = runUpgradeSync(contentDir, dir, { apply: true });
    expect(read("CODEOWNERS")).to.equal(once);
    expect(again.lines.join("\n")).to.not.match(/regenerated CODEOWNERS/);
  });

  it("no Policy Owner → CODEOWNERS is not touched, and the upgrade says why", () => {
    fs.writeFileSync(path.join(dir, "org-config.yaml"), read("org-config.yaml")!.replace(/^policy_owner_github: .*$/m, 'policy_owner_github: ""'));
    fs.writeFileSync(path.join(dir, "CODEOWNERS"), "/x @someone\n");
    const r = runUpgradeSync(contentDir, dir, { apply: true });
    expect(read("CODEOWNERS")).to.equal("/x @someone\n");
    expect(r.lines.join("\n")).to.match(/CODEOWNERS not regenerated.*policy_owner_github/);
  });
});

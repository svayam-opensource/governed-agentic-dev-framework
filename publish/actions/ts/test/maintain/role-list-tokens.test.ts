// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * F19 (svm-geneva re-walk, 2026-10-07): `gov upgrade` seeded policies/authorized-representatives.md with its four
 * holder cells still `<LEGAL_OWNER_GITHUB>`…, and doctor read four roles as vacant with "unresolved token" warnings.
 *
 * A seeded role list never carries a raw token. A holder cell gov seeded is filled from what gov knows (the legacy
 * `*_owner_github` keys), else written as the documented vacant form (`vacant`). Fill-empty-only (GOV-FRM-445): a
 * cell the org wrote — a handle, or its own `vacant` — is never touched.
 */
import { expect } from "chai";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { runUpgradeSync } from "../../src/maintain/upgrade-run.js";
import { ROLE_LIST_PATH, parseRoleList, settleRoleListTokens } from "../../src/config/role-list.js";

const contentDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../content");

const table = (...rows: string[]): string => [
  "# Roles", "", "| Role | GitHub handle | Owns |", "|---|---|---|", ...rows, "",
  "```", "| Role | GitHub handle | Owns |", "|---|---|---|", "| Example | <LEGAL_OWNER_GITHUB> | `knowledge/x/` |", "```", "",
].join("\n");

describe("F19 — a seeded role list never carries a raw token", () => {
  it("fills a token cell from what gov knows, and writes the rest as `vacant`", () => {
    const text = table(
      "| Legal Owner | <LEGAL_OWNER_GITHUB> | `knowledge/legal/` |",
      "| Infrastructure Owner | <INFRA_OWNER_GITHUB> | `knowledge/infrastructure/` |",
    );
    const r = settleRoleListTokens(text, (t) => (t === "LEGAL_OWNER_GITHUB" ? "@lena" : null));
    expect(r.text).to.match(/^\| Legal Owner \| @lena \| `knowledge\/legal\/` \|$/m);
    expect(r.text).to.match(/^\| Infrastructure Owner \| vacant \| `knowledge\/infrastructure\/` \|$/m);
    expect(r.filled).to.deep.equal(["Legal Owner"]);
    expect(r.vacated).to.deep.equal(["Infrastructure Owner"]);
    const parsed = parseRoleList(r.text);
    expect(parsed.found && parsed.problems).to.deep.equal([]);
    // An example in a code fence is prose, not the list — left exactly as written.
    expect(r.text).to.contain("| Example | <LEGAL_OWNER_GITHUB> |");
  });

  it("GOV-FRM-445: a cell the org wrote is never replaced — only a token cell is filled", () => {
    const text = table("| Legal Owner | @org-chose | `knowledge/legal/` |", "| Data Owner | vacant | — |");
    const r = settleRoleListTokens(text, () => "@gov-knows");
    expect(r.text).to.equal(text);
    expect(r.filled).to.deep.equal([]);
    expect(r.vacated).to.deep.equal([]);
  });

  describe("gov upgrade --apply", function () {
    this.timeout(30000);
    let dir = "";
    const read = (rel: string): string => fs.readFileSync(path.join(dir, rel), "utf8");
    beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), "gov-roletok-")); });
    afterEach(() => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* gone */ } });

    it("seeds the role list with no unresolved token: legacy keys fill their rows, the rest read `vacant`", () => {
      // An org from before the split: org-config names one domain owner, the other three nobody.
      fs.writeFileSync(path.join(dir, "org-config.yaml"), [
        'org_name: "Geneva"', 'org_slug: "GEN"', 'github_org: "geneva"', 'workspace_repo: "geneva-gov"',
        'policy_owner_github: "@polly"', 'infra_owner_github: "@ivan"', "",
      ].join("\n"));
      const r = runUpgradeSync(contentDir, dir, { apply: true });
      expect(r.code, r.lines.join("\n")).to.equal(0);
      const list = read(ROLE_LIST_PATH);
      const parsed = parseRoleList(list);
      expect(parsed.found).to.equal(true);
      if (!parsed.found) return;
      expect(parsed.problems, "doctor would warn on these").to.deep.equal([]);
      const holder = (role: string) => parsed.roles.find((x) => x.role === role)?.holder;
      expect(holder("Infrastructure Owner")).to.equal("@ivan");
      for (const role of ["Legal Owner", "System Architecture Owner", "Data Architecture Owner"]) expect(holder(role), role).to.equal(null);
      expect(list).to.not.match(/^\|[^|\n]*\|\s*<[A-Z_]+>\s*\|/m);
      expect(list).to.match(/^\| Legal Owner \| vacant \|/m);
    });

    it("a second upgrade changes nothing in the role list", () => {
      fs.writeFileSync(path.join(dir, "org-config.yaml"), 'org_name: "Geneva"\norg_slug: "GEN"\n');
      runUpgradeSync(contentDir, dir, { apply: true });
      const once = read(ROLE_LIST_PATH);
      runUpgradeSync(contentDir, dir, { apply: true });
      expect(read(ROLE_LIST_PATH)).to.equal(once);
    });
  });
});

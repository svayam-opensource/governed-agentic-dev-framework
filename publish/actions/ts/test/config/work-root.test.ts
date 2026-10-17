// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/** Your work root — a per-developer setting since the org-config split (config/work-root.ts). */
import { expect } from "chai";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { loadOrgConfigText, readWorkRoot, recordWorkRoot, resolveWorkRoot, workRootsFile } from "../../src/config/work-root.js";

describe("gov-work — the work root (~/.gov/work-roots)", () => {
  let home: string;
  beforeEach(() => { home = fs.mkdtempSync(path.join(os.tmpdir(), "gov-wr-")); });
  afterEach(() => fs.rmSync(home, { recursive: true, force: true }));

  it("absent: nobody chose, and the default applies", () => {
    expect(readWorkRoot("acme", home)).to.equal(null);
    expect(resolveWorkRoot('github_org: "acme"\norg_slug: "ACM"\n', home)).to.equal(null);
    expect(loadOrgConfigText('github_org: "acme"\norg_slug: "ACM"\n', home).agentWorkRoot).to.equal(path.join(home, ".gov/acm/projects"));
  });

  it("records and reads a person's own choice, per organization", () => {
    expect(recordWorkRoot("acme", "~/work/acme", home)).to.equal(true);
    recordWorkRoot("other", "/srv/other", home);
    expect(workRootsFile(home)).to.equal(path.join(home, ".gov", "work-roots"));
    expect(readWorkRoot("acme", home)).to.equal("~/work/acme");
    expect(loadOrgConfigText('github_org: "acme"\norg_slug: "ACM"\n', home).agentWorkRoot).to.equal(path.join(home, "work/acme"));
  });

  it("CARRIES an org-config value that differs from the default, so removing the key moves nobody's folders", () => {
    const text = 'github_org: "acme"\norg_slug: "ACM"\nagent_work_root: "~/elsewhere"\n';
    expect(resolveWorkRoot(text, home)).to.equal("~/elsewhere");
    expect(readWorkRoot("acme", home), "recorded on this machine").to.equal("~/elsewhere");
    // …and once the upgrade has removed the key, the recorded value still applies.
    expect(loadOrgConfigText('github_org: "acme"\norg_slug: "ACM"\n', home).agentWorkRoot).to.equal(path.join(home, "elsewhere"));
  });

  it("an org-config value EQUAL to the default records nothing — there is nothing to carry", () => {
    expect(resolveWorkRoot('github_org: "acme"\norg_slug: "ACM"\nagent_work_root: "~/.gov/acm/projects"\n', home)).to.equal(null);
    expect(fs.existsSync(workRootsFile(home))).to.equal(false);
  });

  it("the person's own choice wins over an org-config value", () => {
    recordWorkRoot("acme", "/mine", home);
    expect(resolveWorkRoot('github_org: "acme"\norg_slug: "ACM"\nagent_work_root: "~/theirs"\n', home)).to.equal("/mine");
  });
});

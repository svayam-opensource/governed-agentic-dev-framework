// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
import { expect } from "chai";
import { makePrivacyValidator, privateValuesFromOrgConfig } from "../../src/governance/privacy.js";
import type { ValidateContext } from "../../src/governance/validate.js";
import type { Fs } from "../../src/lifecycle/fs-io.js";
import { px } from "../helpers/paths.js";

const MAIN_CONFIG = `org_name: "Svayam Infoware Pvt"
org_short_name: "Svayam"
org_slug: "SVM"
github_org: "Svayamtech"
workspace_repo: "svm-prj-work"
default_branch: "main"
policy_owner_email: "rkant@svayam.ai"
`;

function ctx(files: Record<string, string>): ValidateContext {
  const at = (p: string) => files[px(p).replace(/^\/repo\//, "")] ?? null;
  const fs: Fs = {
    pathExists: (p) => at(p) !== null,
    readFile: (p) => at(p),
    mkdirp: () => {},
    writeFile: () => {},
    rm: () => {},
    readdir: () => [],
  };
  return { fs, repoRoot: "/repo", files: Object.keys(files) };
}

describe("prj-work Phase 3 — checkPrivacy (port of check_privacy.py)", () => {
  it("extracts non-generic org values, skipping generics like main/dev", () => {
    const vals = privateValuesFromOrgConfig(MAIN_CONFIG);
    const keys = vals.map((v) => v.key);
    expect(keys).to.include.members(["github_org", "workspace_repo", "policy_owner_email"]);
    expect(keys).to.not.include("default_branch"); // not a PRIVATE_KEY
    expect(vals.find((v) => v.value === "main")).to.equal(undefined); // generic skipped
  });

  it("flags a leaked org value in publish content", () => {
    const v = makePrivacyValidator(MAIN_CONFIG);
    const r = v(ctx({ "docs/guide.md": "clone git@github.com:Svayamtech/x\n", "src/x.ts": "ok" }));
    expect(r.ok).to.equal(false);
    // github_org leaks; org_short_name 'Svayam' is a substring of 'Svayamtech' so it's flagged too.
    expect(r.errors.some((e) => /docs\/guide\.md:1: leak of github_org='Svayamtech'/.test(e))).to.equal(true);
  });

  it("allows org_name in attribution files (LICENSE/README) but not elsewhere", () => {
    const v = makePrivacyValidator(MAIN_CONFIG);
    const okFile = v(ctx({ "LICENSE": "Copyright Svayam Infoware Pvt\n" }));
    expect(okFile.ok).to.equal(true);
    const leak = v(ctx({ "docs/x.md": "Svayam Infoware Pvt\n" }));
    expect(leak.ok).to.equal(false);
  });

  it("skips ALLOWED_FILES (setup.sh, org-config.yaml) and dotfiles + non-scan suffixes", () => {
    const v = makePrivacyValidator(MAIN_CONFIG);
    const r = v(
      ctx({
        "setup.sh": "github_org=Svayamtech\n",
        ".github/x.yml": "Svayamtech\n",
        "img.png": "Svayamtech",
      }),
    );
    expect(r.ok).to.equal(true);
  });

  it("passes when main is unconfigured (no org-specific values)", () => {
    const v = makePrivacyValidator("default_branch: main\n");
    expect(v(ctx({ "docs/x.md": "anything" }))).to.deep.equal({ name: "privacy", ok: true, errors: [] });
  });
});

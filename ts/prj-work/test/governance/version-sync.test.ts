// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
import { expect } from "chai";
import { checkVersionSync } from "../../src/governance/version-sync.js";
import { runValidators, type ValidateContext } from "../../src/governance/validate.js";
import type { Fs } from "../../src/lifecycle/fs-io.js";

/** An Fs serving a fixed map of repo-relative path → content. */
function fakeFs(files: Record<string, string>): Fs {
  const at = (p: string) => files[p.replace(/^\/repo\//, "")] ?? null;
  return {
    pathExists: (p) => at(p) !== null,
    readFile: (p) => at(p),
    mkdirp: () => {},
    writeFile: () => {},
    rm: () => {},
    readdir: () => [],
  };
}
const ctx = (files: Record<string, string>): ValidateContext => ({ fs: fakeFs(files), repoRoot: "/repo" });

const README_OK = "![diagram](https://cdn.jsdelivr.net/npm/@svayam-opensource/prj@latest/assets/x.svg)";

describe("prj-work Phase 3 — checkVersionSync (port of check_version_sync.py)", () => {
  it("passes when all three versions agree and the README floats @latest", () => {
    const r = checkVersionSync(
      ctx({
        "package.json": '{"version":"0.7.4"}',
        "framework/VERSION": "0.7.4\n",
        ".framework-version": "0.7.4",
        "README.md": README_OK,
      }),
    );
    expect(r).to.deep.equal({ name: "version-sync", ok: true, errors: [] });
  });

  it("flags a drifting framework/VERSION and a missing .framework-version", () => {
    const r = checkVersionSync(ctx({ "package.json": '{"version":"0.7.4"}', "framework/VERSION": "0.7.3" }));
    expect(r.ok).to.equal(false);
    expect(r.errors.join("\n")).to.match(/framework\/VERSION: '0\.7\.3' != package\.json '0\.7\.4'/);
    expect(r.errors.join("\n")).to.match(/\.framework-version: missing/);
  });

  it("flags a README URL pinned to an exact version instead of @latest", () => {
    const r = checkVersionSync(
      ctx({
        "package.json": '{"version":"0.7.4"}',
        "framework/VERSION": "0.7.4",
        ".framework-version": "0.7.4",
        "README.md": README_OK.replace("@latest", "@0.7.0"),
      }),
    );
    expect(r.ok).to.equal(false);
    expect(r.errors.some((e) => /pinned to @0\.7\.0/.test(e))).to.equal(true);
  });

  it("reports a clear error for missing / unparseable package.json", () => {
    expect(checkVersionSync(ctx({})).errors).to.deep.equal(["package.json not found"]);
    expect(checkVersionSync(ctx({ "package.json": "{bad" })).errors[0]).to.match(/does not parse/);
  });

  it("runValidators aggregates ok + flattened failures", () => {
    const good = ctx({ "package.json": '{"version":"1.0.0"}', "framework/VERSION": "1.0.0", ".framework-version": "1.0.0" });
    expect(runValidators(good, [checkVersionSync])).to.deep.include({ ok: true, failures: [] });
    const bad = ctx({ "package.json": '{"version":"1.0.0"}', "framework/VERSION": "9.9.9" });
    const run = runValidators(bad, [checkVersionSync]);
    expect(run.ok).to.equal(false);
    expect(run.failures[0]).to.match(/^version-sync: /);
  });
});

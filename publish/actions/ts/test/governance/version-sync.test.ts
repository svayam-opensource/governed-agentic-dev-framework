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

const PKG = "publish/actions/ts/package.json";
const VERSION = "publish/content/VERSION";
const README_OK = "![diagram](https://cdn.jsdelivr.net/npm/@svayam-opensource/gov-work@latest/assets/x.svg)";

describe("gov-work — checkVersionSync (CLI ↔ content version)", () => {
  it("passes when the CLI version agrees with content/VERSION and the README floats @latest", () => {
    const r = checkVersionSync(ctx({ [PKG]: '{"version":"1.0.0"}', [VERSION]: "1.0.0\n", "README.md": README_OK }));
    expect(r).to.deep.equal({ name: "version-sync", ok: true, errors: [] });
  });

  it("flags a drifting content/VERSION", () => {
    const r = checkVersionSync(ctx({ [PKG]: '{"version":"1.0.0"}', [VERSION]: "0.9.9" }));
    expect(r.ok).to.equal(false);
    expect(r.errors.join("\n")).to.match(/publish\/content\/VERSION: '0\.9\.9' != CLI '1\.0\.0'/);
  });

  it("flags a README URL pinned to an exact version instead of @latest", () => {
    const r = checkVersionSync(ctx({ [PKG]: '{"version":"1.0.0"}', [VERSION]: "1.0.0", "README.md": README_OK.replace("@latest", "@0.9.0") }));
    expect(r.ok).to.equal(false);
    expect(r.errors.some((e) => /pinned to @0\.9\.0/.test(e))).to.equal(true);
  });

  it("is N/A (passes) outside the framework repo, and flags an unparseable CLI package.json", () => {
    // no CLI package.json (e.g. an adopter workspace) → skip, ok
    expect(checkVersionSync(ctx({})).ok).to.equal(true);
    expect(checkVersionSync(ctx({ [PKG]: "{bad" })).errors[0]).to.match(/does not parse/);
  });

  it("runValidators aggregates ok + flattened failures", () => {
    const good = ctx({ [PKG]: '{"version":"1.0.0"}', [VERSION]: "1.0.0" });
    expect(runValidators(good, [checkVersionSync])).to.deep.include({ ok: true, failures: [] });
    const bad = ctx({ [PKG]: '{"version":"1.0.0"}', [VERSION]: "9.9.9" });
    const run = runValidators(bad, [checkVersionSync]);
    expect(run.ok).to.equal(false);
    expect(run.failures[0]).to.match(/^version-sync: /);
  });
});

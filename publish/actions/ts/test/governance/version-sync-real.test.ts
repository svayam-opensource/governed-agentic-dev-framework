// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * version-sync, against the REAL files (#188).
 *
 * `checkVersionSync` was already covered by fixture tests, and the drift shipped
 * anyway: `package.json` reached 1.2.2 while `publish/content/VERSION` stayed at
 * 1.2.1, and `gov validate` reported PASS throughout.
 *
 * It could not have done otherwise. `gov validate` resolves a GOV WORKSPACE, which
 * needs an `org-config.yaml`. An adopter's workspace has one and holds no CLI
 * source, so the check returns N/A. The framework repo holds the CLI source and has
 * no `org-config.yaml`, so validate refuses to run there at all. The one comparison
 * the validator exists to make was unreachable from every direction.
 *
 * This suite runs IN the framework repo and needs no workspace. So the check lives
 * here, reading the actual files rather than fixtures — which is the only thing
 * that could have caught it.
 */
import { expect } from "chai";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../..");
const PKG = "publish/actions/ts/package.json";
const CONTENT = "publish/content/VERSION";

/**
 * The release a version names. A governed DEV build stamps `<x.y.z>-dev.g<sha7>` into package.json and then
 * publishes — and publishing runs this suite (`prepublishOnly`). That prerelease IS release x.y.z, with its
 * content unchanged, so it is in lockstep with a VERSION of x.y.z. Only gov's own stamp is stripped: any other
 * difference, including a different x.y.z, is still drift. Without this every dev deploy failed here, from
 * the first one after the suite was added (gov 1.2.3, Jenkins deploy/dev/gov-work #16).
 */
export const releaseOf = (version: string): string => version.replace(/-dev\.g[0-9a-f]{7,40}$/, "");

describe("gov-work — version-sync (the real files)", () => {
  it("the CLI package version and the shipped content VERSION are the same", () => {
    const pkgPath = path.join(repoRoot, PKG);
    const verPath = path.join(repoRoot, CONTENT);

    // If this fails, the test is looking in the wrong place — fix the path, do not
    // weaken the assertion.
    expect(fs.existsSync(pkgPath), `${pkgPath} should exist`).to.equal(true);
    expect(fs.existsSync(verPath), `${verPath} should exist`).to.equal(true);

    const cli = (JSON.parse(fs.readFileSync(pkgPath, "utf8")) as { version: string }).version.trim();
    const content = fs.readFileSync(verPath, "utf8").trim();

    expect(content, `${CONTENT} is '${content}' but ${PKG} is '${cli}' — ` +
      "these move in lockstep. `gov bump-version <x.y.z>` writes both.").to.equal(releaseOf(cli));
  });

  it("a gov dev build of the same release is in lockstep; anything else is still drift", () => {
    expect(releaseOf("1.2.3-dev.g604c0ae")).to.equal("1.2.3");
    expect(releaseOf("1.2.3")).to.equal("1.2.3");
    expect(releaseOf("1.2.4-dev.g604c0ae"), "a dev build of a DIFFERENT release must not match 1.2.3").to.not.equal("1.2.3");
    expect(releaseOf("1.2.3-rc.1"), "only gov's own dev stamp is stripped").to.equal("1.2.3-rc.1");
    expect(releaseOf("1.2.3-dev.gZZZZZZZ"), "not a sha").to.equal("1.2.3-dev.gZZZZZZZ");
  });
});

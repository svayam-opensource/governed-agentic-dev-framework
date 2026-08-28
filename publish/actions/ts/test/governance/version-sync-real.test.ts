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
      "these move in lockstep. `gov bump-version <x.y.z>` writes both.").to.equal(cli);
  });
});

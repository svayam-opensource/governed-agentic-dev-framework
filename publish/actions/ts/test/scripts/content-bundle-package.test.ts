// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
//
// THE PACKAGE CARRIES THE CONTENT IT WAS BUILT WITH (Policy Owner, 2026-10-07, option B). Against this checkout's
// real build: the bundle holds exactly publish/content's framework content, the recorded fingerprint is computed
// over exactly the bundled tree, and `npm pack` ships the bundle — with stdout that is still one JSON document.
import { expect } from "chai";
import { execFileSync, spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { BUILD_IDENTITY_PATH, contentFingerprint } from "../../src/maintain/build-identity.js";
import { CONTENT_BUNDLE_PATH, fingerprintEntries, materializeContentBundle, readContentBundle } from "../../src/maintain/content-bundle.js";

const root = fileURLToPath(new URL("../../", import.meta.url));
const contentDir = path.resolve(root, "..", "..", "content");

describe("the gov package bundles its framework content", () => {
  before(function () {
    // The bundle is written by the build (postbuild). Write it fresh, so this tests this tree, not a stale lib/.
    if (!fs.existsSync(path.join(root, "lib", "esm", "maintain", "build-identity.js"))) this.skip();
    const r = spawnSync(process.execPath, ["scripts/write-build-identity.mjs"], { cwd: root, encoding: "utf8" });
    expect(r.status, r.stderr).to.equal(0);
  });

  it("the recorded fingerprint is computed over exactly the bundled tree — and is the source content's", () => {
    const id = JSON.parse(fs.readFileSync(path.join(root, BUILD_IDENTITY_PATH), "utf8")) as { contentFingerprint: string };
    const entries = readContentBundle(path.join(root, CONTENT_BUNDLE_PATH));
    expect(fingerprintEntries(entries)).to.equal(id.contentFingerprint);
    const m = materializeContentBundle(path.join(root, CONTENT_BUNDLE_PATH));
    try { expect(contentFingerprint(m.contentDir)).to.equal(id.contentFingerprint); } finally { m.cleanup(); }
    expect(contentFingerprint(contentDir)).to.equal(id.contentFingerprint);
  });

  it("bundles every file the MANIFEST ships, and nothing it does not", () => {
    const bundled = readContentBundle(path.join(root, CONTENT_BUNDLE_PATH)).map((e) => e.path).sort();
    expect(bundled).to.include.members(["MANIFEST.yaml", ".gitignore", "VERSION", "org-config.example.yaml"]);
    let tracked: string[];
    try { tracked = execFileSync("git", ["-C", contentDir, "ls-files"], { encoding: "utf8" }).split("\n").filter(Boolean); }
    catch { return; /* no git (an image build): the MANIFEST selection above is the whole rule */ }
    // Every bundled file is tracked content (no litter, no local file); a tracked file not bundled is one the
    // MANIFEST does not ship — never seen by an organization, and not part of the identity.
    expect(bundled.filter((p) => !tracked.includes(p))).to.deep.equal([]);
  });

  it("npm pack ships the bundle, and its --json stdout parses (gov-cicd reads it)", function () {
    this.timeout(60000);
    const r = spawnSync("npm", ["pack", "--dry-run", "--json", "--ignore-scripts"], { cwd: root, encoding: "utf8" });
    expect(r.status, r.stderr).to.equal(0);
    const packed = JSON.parse(r.stdout) as { files: { path: string }[] }[];
    const files = packed[0]!.files.map((f) => f.path);
    expect(files).to.include(CONTENT_BUNDLE_PATH);
    expect(files).to.include(BUILD_IDENTITY_PATH);
    expect(files.filter((f) => f.startsWith("publish/") || f.startsWith("src/")), "not the repo's tree").to.deep.equal([]);
  });
});

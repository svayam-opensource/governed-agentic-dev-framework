// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * Record which framework content this gov is built with (src/maintain/build-identity.ts) — run by `postbuild`,
 * after tsc, so it uses the compiled fingerprint the installed gov will use to check content.
 *
 * Fails the build when publish/content is not beside the package: a gov that cannot say what content it was
 * built with is a gov whose `gov upgrade` must refuse everything, and that should surface here, not at an adopter.
 */
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { writeBuildIdentity } from "../lib/esm/maintain/build-identity.js";

const pkgRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const contentDir = path.resolve(pkgRoot, "..", "..", "content");
if (!fs.existsSync(path.join(contentDir, "MANIFEST.yaml"))) {
  console.error(`write-build-identity: no framework content at ${contentDir} — gov must be built inside the framework repository.`);
  process.exit(1);
}
const git = (...args) => { try { return execFileSync("git", ["-C", pkgRoot, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); } catch { return null; } };
const commit = git("rev-parse", "HEAD");
const dirty = commit !== null && (git("status", "--porcelain", "--", contentDir) ?? "") !== "";
const { version } = JSON.parse(fs.readFileSync(path.join(pkgRoot, "package.json"), "utf8"));
const id = writeBuildIdentity(pkgRoot, contentDir, { version, commit, dirty });
console.log(`build identity: content ${id.contentFingerprint.slice(7, 19)}${commit ? ` @ ${commit.slice(0, 12)}${dirty ? " (+ uncommitted content)" : ""}` : " (no git commit)"}`);

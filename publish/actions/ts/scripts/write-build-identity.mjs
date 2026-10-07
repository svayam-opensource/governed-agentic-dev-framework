// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * Bundle the framework content into the package and record its identity (src/maintain/build-identity.ts,
 * content-bundle.ts) — run by `postbuild`, after tsc, so it uses the compiled code the installed gov will use.
 * The package then CARRIES the content it was built with (Policy Owner, 2026-10-07, option B): `lib/content-bundle.json`,
 * fingerprinted exactly as bundled. The commit is recorded when the build is in git, and is never required.
 *
 * Fails the build when publish/content is not beside the package: a gov without its content cannot seed or upgrade
 * anything, and that should surface here, not at an adopter.
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
// STDERR, never stdout: this runs inside `npm pack --json` (prepack → build → postbuild), and gov-cicd parses that
// stdout as JSON — a log line there broke every deploy of gov ("build iden… is not valid JSON", 2026-10-07).
console.error(`build identity: content ${id.contentFingerprint.slice(7, 19)} (${id.files} files bundled)${commit ? ` @ ${commit.slice(0, 12)}${dirty ? " (+ uncommitted content)" : ""}` : " (no git commit)"}`);

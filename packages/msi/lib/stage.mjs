// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * THE STAGED TREE — exactly what the MSI lays down under %LOCALAPPDATA%\Programs\gov (spec 04 §4.2):
 *
 *   node\   nodejs.org's Node 24 for the arch, checksum-verified, unchanged
 *   app\    the gov package (the `npm pack` tarball) + its production dependencies, `npm ci` from the lockfile
 *   bin\    the launcher, gov.cmd — and nothing else; the only directory the MSI puts on the user PATH
 *
 * Every effect on the world (download, unpack, npm) is injected so the rules are tested on any OS. No network is
 * needed at install time: everything gov needs is in this tree (ruling Q4 A).
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { assertArch, nodeDistUrl, nodeZipName, normalizeNodeVersion, parseShasums, verifyChecksum } from "./node-dist.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));

/**
 * What bin\ holds. gov.cmd only: a gov.ps1 beside it would be picked by PowerShell ahead of gov.cmd and refused
 * under Windows' default execution policy (Restricted) — the well-known `npm.ps1 cannot be loaded` failure. gov.cmd
 * runs from cmd, PowerShell and Windows Terminal alike. See README.md, "Why there is no gov.ps1".
 */
export const LAUNCHERS = Object.freeze(["gov.cmd"]);

/** The MSI ProductVersion: numeric major.minor.patch (Windows Installer: 255.255.65535 at most). */
export function msiVersion(v) {
  const m = /^v?(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/.exec(String(v).trim());
  if (!m) throw new Error(`not a package version: ${v}`);
  const [maj, min, pat] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (maj > 255 || min > 255 || pat > 65535) throw new Error(`MSI versions allow at most 255.255.65535; ${v} does not fit`);
  return `${maj}.${min}.${pat}`;
}

/** The launcher text for a package whose `bin.gov` is `binJs` (e.g. `./lib/esm/cli/bin.js`). CRLF line ends. */
export function govCmd(binJs) {
  const rel = String(binJs).replace(/^\.\//, "").replace(/\//g, "\\");
  const tmpl = fs.readFileSync(path.join(HERE, "..", "launchers", "gov.cmd"), "utf8");
  return tmpl.replace("{{BIN_JS}}", rel).split(/\r?\n/).join("\r\n");
}

function binEntry(pkg) {
  if (typeof pkg.bin === "string") return pkg.bin;
  if (pkg.bin && typeof pkg.bin.gov === "string") return pkg.bin.gov;
  throw new Error(`${pkg.name ?? "the package"} declares no "gov" bin entry`);
}

/** The one directory an archive unpacked into (both nodejs.org zips and npm tarballs have exactly one). */
function onlyDir(dir, expect) {
  const p = path.join(dir, expect);
  if (!fs.existsSync(p)) throw new Error(`expected ${expect}\\ inside the archive; found ${fs.readdirSync(dir).join(", ") || "nothing"}`);
  return p;
}

/**
 * Build the tree. `inp`: { version, arch, outDir, govTgz, govLock, nodeVersion }.
 * `deps`: { download(url) → Buffer, extractZip(zip, into), extractTgz(tgz, into), npmCi(dir), log(msg) }.
 * Returns { root, nodeZip, nodeSha256 }.
 */
export async function stage(inp, deps) {
  const arch = assertArch(inp.arch);
  const nodeVersion = normalizeNodeVersion(inp.nodeVersion);
  if (!inp.govTgz || !fs.existsSync(inp.govTgz)) throw new Error(`gov package tarball not found: ${inp.govTgz}`);
  if (!inp.govLock || !fs.existsSync(inp.govLock)) throw new Error(`gov's package-lock.json not found: ${inp.govLock} (npm ci needs it)`);
  const out = path.resolve(inp.outDir);
  const root = path.join(out, `stage-${arch}`);
  const work = path.join(out, `work-${arch}`);
  fs.rmSync(root, { recursive: true, force: true });
  fs.rmSync(work, { recursive: true, force: true });
  fs.mkdirSync(work, { recursive: true });

  // 1. Node: SHASUMS256.txt, the zip, the check — and only then unpack.
  const zipName = nodeZipName(nodeVersion, arch);
  deps.log(`Node ${nodeVersion} ${arch}: fetching ${zipName} and SHASUMS256.txt`);
  const sums = parseShasums((await deps.download(nodeDistUrl(nodeVersion, "SHASUMS256.txt"))).toString("utf8"));
  const zip = await deps.download(nodeDistUrl(nodeVersion, zipName));
  const nodeSha256 = verifyChecksum(zip, zipName, sums);
  deps.log(`✓ ${zipName} matches SHASUMS256.txt (${nodeSha256})`);
  const zipPath = path.join(work, zipName);
  fs.writeFileSync(zipPath, zip);
  await deps.extractZip(zipPath, work);
  fs.mkdirSync(root, { recursive: true });
  fs.renameSync(onlyDir(work, zipName.replace(/\.zip$/, "")), path.join(root, "node"));

  // 2. gov: the packed tarball, its version checked, its production dependencies from the lockfile.
  const govWork = path.join(work, "gov");
  fs.mkdirSync(govWork, { recursive: true });
  await deps.extractTgz(path.resolve(inp.govTgz), govWork);
  const app = path.join(root, "app");
  fs.renameSync(onlyDir(govWork, "package"), app);
  const pkg = JSON.parse(fs.readFileSync(path.join(app, "package.json"), "utf8"));
  if (pkg.version !== inp.version) {
    throw new Error(`the tarball is ${pkg.name}@${pkg.version}, but the build was asked for ${inp.version}`);
  }
  fs.copyFileSync(inp.govLock, path.join(app, "package-lock.json"));
  deps.log(`gov ${pkg.version}: npm ci --omit=dev`);
  await deps.npmCi(app);

  // 3. bin\: the launcher, nothing else.
  const bin = path.join(root, "bin");
  fs.mkdirSync(bin, { recursive: true });
  fs.writeFileSync(path.join(bin, "gov.cmd"), govCmd(binEntry(pkg)));

  fs.rmSync(work, { recursive: true, force: true });
  deps.log(`✓ staged ${root}`);
  return { root, nodeZip: zipName, nodeSha256 };
}

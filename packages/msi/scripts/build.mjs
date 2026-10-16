#!/usr/bin/env node
// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * Build gov-<version>-<arch>.msi (UNSIGNED). Signing is a separate step (scripts/sign.mjs) so the pipeline that owns
 * the key signs with it (plan 04 decision 1, ruling Q8 A). Runs on Windows with `wix` (v4) on PATH; `--stage-only`
 * stops before WiX and runs anywhere.
 *
 *   node packages/msi/scripts/build.mjs --version 1.2.3 --arch x64 --out <dir> --gov-tgz <gov-1.2.3.tgz>
 *        [--gov-lock <package-lock.json>] [--node-version v24.x.y] [--stage-only]
 *
 * Prints the MSI path on its last line. See ../README.md.
 */
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { assertArch, normalizeNodeVersion } from "../lib/node-dist.mjs";
import { msiVersion, stage } from "../lib/stage.mjs";
import { componentsWxs } from "../lib/wxs.mjs";

const PKG = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_LOCK = path.resolve(PKG, "..", "..", "publish", "actions", "ts", "package-lock.json");
const USAGE = "usage: build.mjs --version <x.y.z> --arch <x64|arm64> --out <dir> --gov-tgz <file> [--gov-lock <file>] [--node-version <v24.x.y>] [--stage-only]";

export function parseArgs(argv) {
  const a = { stageOnly: false };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    const v = () => { const x = argv[++i]; if (x === undefined) throw new Error(`${k} needs a value\n${USAGE}`); return x; };
    if (k === "--version") a.version = v();
    else if (k === "--arch") a.arch = v();
    else if (k === "--out") a.outDir = v();
    else if (k === "--gov-tgz") a.govTgz = v();
    else if (k === "--gov-lock") a.govLock = v();
    else if (k === "--node-version") a.nodeVersion = v();
    else if (k === "--stage-only") a.stageOnly = true;
    else throw new Error(`unknown argument ${k}\n${USAGE}`);
  }
  for (const [k, f] of [["--version", "version"], ["--arch", "arch"], ["--out", "outDir"], ["--gov-tgz", "govTgz"]]) {
    if (!a[f]) throw new Error(`${k} is required\n${USAGE}`);
  }
  assertArch(a.arch);
  a.govLock ??= DEFAULT_LOCK;
  a.nodeVersion = normalizeNodeVersion(a.nodeVersion ?? fs.readFileSync(path.join(PKG, "node-version.txt"), "utf8").trim());
  return a;
}

function run(cmd, args, opts = {}) {
  // npm and wix are .cmd/.exe shims on Windows; nothing user-controlled is interpolated here.
  const r = spawnSync(cmd, args, { stdio: "inherit", shell: process.platform === "win32", ...opts });
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(" ")} failed (exit ${r.status ?? r.signal})`);
}

async function download(url) {
  let last;
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
      return Buffer.from(await res.arrayBuffer());
    } catch (e) { last = e; await new Promise((r) => setTimeout(r, 2000 * attempt)); }
  }
  throw last;
}

/**
 * How to unpack an archive. On Windows, ALWAYS System32\tar.exe (bsdtar, Windows 10+): it reads zip and tgz, and a
 * GNU tar earlier on PATH (Git Bash's) takes `D:\…` for a remote host — "tar: Cannot connect to D: resolve failed",
 * found by adopter-e2e / windows. GNU tar on Linux does not read zip, so Linux uses unzip. Never through a shell.
 */
export function extractCommand(kind, archive, into, platform = process.platform, env = process.env) {
  if (platform === "win32") {
    const tar = path.win32.join(env.SystemRoot ?? env.SYSTEMROOT ?? "C:\\Windows", "System32", "tar.exe");
    return { cmd: tar, args: [kind === "zip" ? "-xf" : "-xzf", archive, "-C", into], shell: false };
  }
  if (kind === "zip" && platform === "linux") return { cmd: "unzip", args: ["-q", archive, "-d", into], shell: false };
  return { cmd: "tar", args: [kind === "zip" ? "-xf" : "-xzf", archive, "-C", into], shell: false };
}
const extract = (kind) => async (archive, into) => {
  const c = extractCommand(kind, archive, into);
  run(c.cmd, c.args, { shell: c.shell });
};

export const realDeps = {
  download,
  extractZip: extract("zip"),
  extractTgz: extract("tgz"),
  npmCi: async (dir) => run("npm", ["ci", "--omit=dev", "--ignore-scripts", "--no-audit", "--no-fund"], { cwd: dir }),
  log: (m) => console.log(m),
};

export async function build(a, deps = realDeps) {
  const { root } = await stage(a, deps);
  const wxs = path.join(path.resolve(a.outDir), `components-${a.arch}.wxs`);
  fs.writeFileSync(wxs, componentsWxs(root));
  if (a.stageOnly) return { root, msi: null };
  const msi = path.join(path.resolve(a.outDir), `gov-${a.version}-${a.arch}.msi`);
  run("wix", [
    "build", "-arch", a.arch, "-d", `ProductVersion=${msiVersion(a.version)}`,
    "-ext", "WixToolset.UI.wixext", "-ext", "WixToolset.Util.wixext",
    "-o", msi, path.join(PKG, "wix", "Package.wxs"), wxs,
  ], { cwd: path.join(PKG, "wix") });
  deps.log(`✓ built ${msi} (unsigned — sign with scripts/sign.mjs)`);
  return { root, msi };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const r = await build(parseArgs(process.argv.slice(2)));
    console.log(r.msi ?? r.root);
  } catch (e) {
    console.error(`✗ ${e instanceof Error ? e.message : e}`);
    process.exit(1);
  }
}

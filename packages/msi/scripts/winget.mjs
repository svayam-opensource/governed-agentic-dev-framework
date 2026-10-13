#!/usr/bin/env node
// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * Render the winget manifests for SIGNED MSIs (plan 04 T15). gov-cicd's prod promote runs this on the bytes it ships
 * and puts the output in its microsoft/winget-pkgs PR. Writes <out>/manifests/s/Svayam/Gov/<version>/ and prints
 * that directory on its last line. On Windows, check it with `winget validate --manifest <dir>`.
 *
 *   node packages/msi/scripts/winget.mjs --version 1.2.3 --out <dir> [--url-template <url with {file}>]
 *        [--release-date YYYY-MM-DD] gov-1.2.3-x64.msi gov-1.2.3-arm64.msi
 */
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import { renderWinget } from "../lib/winget.mjs";

const USAGE = "usage: winget.mjs --version <x.y.z> --out <dir> [--url-template <url>] [--release-date YYYY-MM-DD] <gov-x.y.z-<arch>.msi>...";

export function main(argv, print = (l) => console.log(l)) {
  const a = { msis: [] };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    const v = () => { const x = argv[++i]; if (x === undefined) throw new Error(`${k} needs a value\n${USAGE}`); return x; };
    if (k === "--version") a.version = v();
    else if (k === "--out") a.out = v();
    else if (k === "--url-template") a.urlTemplate = v();
    else if (k === "--release-date") a.releaseDate = v();
    else if (k.startsWith("--")) throw new Error(`unknown argument ${k}\n${USAGE}`);
    else a.msis.push(k);
  }
  if (!a.version || !a.out || !a.msis.length) throw new Error(USAGE);
  const installers = a.msis.map((f) => {
    const abs = path.resolve(f);
    if (!fs.existsSync(abs)) throw new Error(`not found: ${abs}`);
    const m = /^gov-(.+)-(x64|arm64)\.msi$/.exec(path.basename(abs));
    if (!m || m[1] !== a.version) throw new Error(`${path.basename(abs)}: expected gov-${a.version}-<arch>.msi`);
    return { arch: m[2], sha256: createHash("sha256").update(fs.readFileSync(abs)).digest("hex") };
  });
  const r = renderWinget({ version: a.version, installers, urlTemplate: a.urlTemplate, releaseDate: a.releaseDate });
  const dir = path.join(path.resolve(a.out), r.dir);
  fs.mkdirSync(dir, { recursive: true });
  for (const [name, text] of Object.entries(r.files)) fs.writeFileSync(path.join(dir, name), text);
  print(dir);
  return dir;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try { main(process.argv.slice(2)); } catch (e) { console.error(`✗ ${e instanceof Error ? e.message : e}`); process.exit(1); }
}

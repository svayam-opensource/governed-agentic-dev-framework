#!/usr/bin/env node
// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * Sign built MSIs with the CALLER's signer — this package holds no key and never will (spec 04 §4.3, ruling Q8 A).
 * gov-cicd passes its own command (jsign / osslsigncode against the HSM; signtool or Set-AuthenticodeSignature with
 * a test certificate made inside a CI job); `{file}` is replaced by each MSI's quoted path. The command must sign in
 * place and timestamp (RFC 3161). Prints `<sha256>  <file>` per signed file — the hash winget's manifest needs.
 *
 *   node packages/msi/scripts/sign.mjs --signer "<command with {file}>" <msi>...
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { pathToFileURL } from "node:url";

export function signerCommand(template, file, platform = process.platform) {
  if (!template.includes("{file}")) throw new Error("the signer command must contain {file} where the MSI path goes");
  let q;
  if (platform === "win32") {
    if (file.includes('"')) throw new Error(`cannot quote ${file} for cmd.exe`);
    q = `"${file}"`;
  } else {
    if (file.includes("'")) throw new Error(`cannot quote ${file} for sh`);
    q = `'${file}'`;
  }
  return template.split("{file}").join(q);
}

function main(argv) {
  const i = argv.indexOf("--signer");
  if (i < 0 || !argv[i + 1]) throw new Error('usage: sign.mjs --signer "<command with {file}>" <msi>...');
  const tmpl = argv[i + 1];
  const files = argv.filter((_, j) => j !== i && j !== i + 1);
  if (!files.length) throw new Error("no files to sign");
  for (const f of files) {
    const abs = path.resolve(f);
    if (!fs.existsSync(abs)) throw new Error(`not found: ${abs}`);
    const before = createHash("sha256").update(fs.readFileSync(abs)).digest("hex");
    const r = spawnSync(signerCommand(tmpl, abs), { shell: true, stdio: "inherit" });
    if (r.status !== 0) throw new Error(`the signer failed on ${abs} (exit ${r.status ?? r.signal})`);
    const after = createHash("sha256").update(fs.readFileSync(abs)).digest("hex");
    if (after === before) throw new Error(`the signer exited 0 but ${abs} is unchanged — it must sign in place`);
    console.log(`${after}  ${abs}`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try { main(process.argv.slice(2)); } catch (e) { console.error(`✗ ${e instanceof Error ? e.message : e}`); process.exit(1); }
}

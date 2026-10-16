// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * THE WINGET LISTING `Svayam.Gov` (PRJ-121 plan 04 T15; spec 04 §4.2, §4.4). Renders the three multi-file manifests
 * microsoft/winget-pkgs takes, from the templates in ../winget/. Only gov-cicd's prod promote uses this, on the
 * MSIs it ships — the hash in the listing is the hash of those bytes, so the listing can only ever install what
 * gov-cicd released. Those MSIs are UNSIGNED until a production certificate exists (P1 REVISED, Policy Owner
 * 2026-10-14; gov-cicd `msi.signing.prod: unsigned`): winget needs no signature — it checks InstallerSha256 —
 * which is why winget is the Windows door. Nothing here depends on a signature. Opening the winget-pkgs PR is gov-cicd's (P7's account), never this package's.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { assertArch } from "./node-dist.mjs";

const TMPL = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "winget");
export const WINGET_ID = "Svayam.Gov";
export const MANIFEST_VERSION = "1.10.0";
/** Where gov-cicd publishes the released MSIs: the release `gov-msi-v<version>` of the catalog's release_repo. */
export const DEFAULT_URL_TEMPLATE =
  "https://github.com/svayam-opensource/governed-agentic-dev-framework/releases/download/gov-msi-v{version}/{file}";

const fill = (text, vars) => text.replace(/\{\{([A-Z0-9_]+)\}\}/g, (m, k) => {
  if (!(k in vars)) throw new Error(`template field ${m} has no value`);
  return vars[k];
});
const read = (name) => fs.readFileSync(path.join(TMPL, name), "utf8").replace(/\r\n/g, "\n");

/**
 * `inp`: { version, installers: [{ arch, sha256 }], urlTemplate?, releaseDate? (YYYY-MM-DD) }.
 * Returns { dir: "manifests/s/Svayam/Gov/<version>", files: { "<name>.yaml": text } }.
 */
export function renderWinget(inp) {
  const version = String(inp.version ?? "");
  if (!/^\d+\.\d+\.\d+$/.test(version)) {
    throw new Error(`winget lists prod releases only: ${version || "(no version)"} is not a plain x.y.z (a pre-release or dev build is never listed)`);
  }
  const list = inp.installers ?? [];
  if (!list.length) throw new Error("at least one installer (arch + sha256) is needed");
  const seen = new Set();
  const urlTemplate = inp.urlTemplate ?? DEFAULT_URL_TEMPLATE;
  if (!urlTemplate.includes("{file}")) throw new Error("the URL template must contain {file} (the MSI's file name)");
  const entries = list.map(({ arch, sha256 }) => {
    assertArch(arch);
    if (seen.has(arch)) throw new Error(`arch ${arch} is listed twice (duplicate installer)`);
    seen.add(arch);
    if (!/^[0-9a-fA-F]{64}$/.test(String(sha256))) throw new Error(`sha256 for ${arch} is not a SHA-256 hex digest: ${sha256}`);
    const file = `gov-${version}-${arch}.msi`;
    const url = urlTemplate.split("{version}").join(version).split("{file}").join(file);
    return fill(read("installer-entry.yaml.tmpl"), { ARCH: arch, URL: url, SHA256: String(sha256).toUpperCase() }).trimEnd();
  });
  const releaseDate = inp.releaseDate ?? new Date().toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(releaseDate)) throw new Error(`releaseDate must be YYYY-MM-DD; got ${releaseDate}`);
  const vars = { ID: WINGET_ID, VERSION: version, MANIFEST_VERSION, RELEASE_DATE: releaseDate, INSTALLERS: entries.join("\n") };
  const files = {};
  for (const name of [`${WINGET_ID}.yaml`, `${WINGET_ID}.installer.yaml`, `${WINGET_ID}.locale.en-US.yaml`]) {
    files[name] = fill(read(`${name}.tmpl`), vars);
  }
  return { dir: `manifests/s/Svayam/Gov/${version}`, files };
}

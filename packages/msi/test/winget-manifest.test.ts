// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * The winget listing Svayam.Gov (PRJ-121 plan 04 T15; spec 04 §4.2, §4.4). gov-cicd's prod promote renders these
 * manifests from the SIGNED MSIs it ships and opens the microsoft/winget-pkgs PR (P7). Here: the rendered manifests
 * are well formed against winget's multi-file schema, carry the per-user scope and the "run gov in a new terminal"
 * release note, and their InstallerSha256 is the hash of the very bytes given. `winget validate` itself runs on the
 * Windows job (adopter-e2e / windows) when the runner has winget.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { renderWinget, WINGET_ID, MANIFEST_VERSION } from "../lib/winget.mjs";
import { main as wingetCli } from "../scripts/winget.mjs";

const tmp = (): string => fs.mkdtempSync(path.join(os.tmpdir(), "gov-winget-test-"));
const sha = (b: Buffer): string => createHash("sha256").update(b).digest("hex").toUpperCase();
const X64 = Buffer.from("signed x64 msi bytes");
const ARM = Buffer.from("signed arm64 msi bytes");
const installers = [{ arch: "x64", sha256: sha(X64) }, { arch: "arm64", sha256: sha(ARM) }];

/** A flat reading of the YAML we emit: top-level `Key: value` pairs, and the list items under `Installers:`. */
function top(text: string): Map<string, string> {
  const m = new Map<string, string>();
  for (const l of text.split("\n")) { const h = /^([A-Za-z0-9]+):\s?(.*)$/.exec(l); if (h) m.set(h[1], h[2]); }
  return m;
}
function items(text: string): Map<string, string>[] {
  const out: Map<string, string>[] = [];
  for (const l of text.split("\n")) {
    const h = /^(- |  )([A-Za-z0-9]+):\s?(.*)$/.exec(l);
    if (!h) continue;
    if (h[1] === "- ") out.push(new Map());
    out.at(-1)?.set(h[2], h[3]);
  }
  return out;
}

test("three manifests, named and typed as winget-pkgs expects", () => {
  const r = renderWinget({ version: "1.2.3", installers });
  assert.equal(WINGET_ID, "Svayam.Gov");
  assert.equal(r.dir, "manifests/s/Svayam/Gov/1.2.3");
  assert.deepEqual(Object.keys(r.files).sort(), ["Svayam.Gov.installer.yaml", "Svayam.Gov.locale.en-US.yaml", "Svayam.Gov.yaml"]);
  const want: Record<string, string> = { "Svayam.Gov.yaml": "version", "Svayam.Gov.installer.yaml": "installer", "Svayam.Gov.locale.en-US.yaml": "defaultLocale" };
  for (const [name, text] of Object.entries(r.files)) {
    const t = top(text);
    assert.equal(t.get("PackageIdentifier"), "Svayam.Gov", name);
    assert.equal(t.get("PackageVersion"), "1.2.3", name);
    assert.equal(t.get("ManifestType"), want[name], name);
    assert.equal(t.get("ManifestVersion"), MANIFEST_VERSION, name);
    assert.match(text, new RegExp(`^# yaml-language-server: \\$schema=https://aka\\.ms/winget-manifest\\.${want[name].replace("defaultLocale", "defaultLocale")}\\.${MANIFEST_VERSION.replace(/\./g, "\\.")}\\.schema\\.json`), name);
    assert.doesNotMatch(text, /\{\{|\}\}/, `${name}: no template field left unfilled`);
    assert.doesNotMatch(text, /\t/, `${name}: YAML has no tabs`);
  }
  assert.equal(top(r.files["Svayam.Gov.yaml"]).get("DefaultLocale"), "en-US");
});

test("the installer manifest: a per-user WiX MSI per arch, each with the hash of its own bytes and its release URL", () => {
  const r = renderWinget({ version: "1.2.3", installers });
  const text = r.files["Svayam.Gov.installer.yaml"];
  const t = top(text);
  assert.equal(t.get("InstallerType"), "wix");
  assert.equal(t.get("Scope"), "user", "per-user, no elevation (Q5 A)");
  assert.equal(t.get("UpgradeBehavior"), "install", "MajorUpgrade replaces the old version in place (§4.4)");
  assert.equal(t.get("ElevationRequirement"), undefined);
  const list = items(text.slice(text.indexOf("Installers:")));
  assert.deepEqual(list.map((i) => i.get("Architecture")), ["x64", "arm64"]);
  for (const [i, bytes] of [[0, X64], [1, ARM]] as const) {
    assert.equal(list[i].get("InstallerSha256"), sha(bytes));
    assert.match(list[i].get("InstallerSha256") ?? "", /^[0-9A-F]{64}$/);
    assert.equal(list[i].get("InstallerUrl"),
      `https://github.com/svayam-opensource/governed-agentic-dev-framework/releases/download/gov-msi-v1.2.3/gov-1.2.3-${list[i].get("Architecture")}.msi`);
  }
});

test("the locale manifest says what to do after a silent install: run gov in a new terminal", () => {
  const t = renderWinget({ version: "1.2.3", installers }).files["Svayam.Gov.locale.en-US.yaml"];
  const m = top(t);
  for (const k of ["PackageLocale", "Publisher", "PackageName", "License", "ShortDescription", "Moniker"]) assert.ok(m.get(k), k);
  assert.equal(m.get("Moniker"), "gov");
  assert.match(t, /ReleaseNotes: .*run `gov` in a new terminal/);
  assert.ok((m.get("ShortDescription") ?? "").length <= 256);
});

test("refuses what winget-pkgs would refuse, or what would list the wrong bytes", () => {
  assert.throws(() => renderWinget({ version: "1.2.3-dev.gabc1234", installers }), /prod|pre-release/i);
  assert.throws(() => renderWinget({ version: "1.2.3", installers: [] }), /installer/);
  assert.throws(() => renderWinget({ version: "1.2.3", installers: [{ arch: "x86", sha256: sha(X64) }] }), /arch/);
  assert.throws(() => renderWinget({ version: "1.2.3", installers: [{ arch: "x64", sha256: "abc" }] }), /sha256/i);
  assert.throws(() => renderWinget({ version: "1.2.3", installers: [installers[0], installers[0]] }), /twice|duplicate/i);
  assert.throws(() => renderWinget({ version: "1.2.3", installers, urlTemplate: "https://example.com/gov.msi" }), /\{file\}/);
});

test("the CLI hashes the MSI files it is given — the listing names exactly the bytes gov-cicd signed", () => {
  const d = tmp();
  fs.writeFileSync(path.join(d, "gov-1.2.3-x64.msi"), X64);
  fs.writeFileSync(path.join(d, "gov-1.2.3-arm64.msi"), ARM);
  const out = path.join(d, "out");
  const lines: string[] = [];
  wingetCli(["--version", "1.2.3", "--out", out, path.join(d, "gov-1.2.3-x64.msi"), path.join(d, "gov-1.2.3-arm64.msi")], (l: string) => lines.push(l));
  const inst = fs.readFileSync(path.join(out, "manifests/s/Svayam/Gov/1.2.3/Svayam.Gov.installer.yaml"), "utf8");
  assert.ok(inst.includes(`InstallerSha256: ${sha(X64)}`));
  assert.ok(inst.includes(`InstallerSha256: ${sha(ARM)}`));
  assert.equal(lines.at(-1), path.join(out, "manifests/s/Svayam/Gov/1.2.3"));
  assert.throws(() => wingetCli(["--version", "1.2.3", "--out", out, path.join(d, "gov-1.2.4-x64.msi")], () => undefined), /not found|1\.2\.4/);
  fs.writeFileSync(path.join(d, "gov-9.9.9-x64.msi"), X64);
  assert.throws(() => wingetCli(["--version", "1.2.3", "--out", out, path.join(d, "gov-9.9.9-x64.msi")], () => undefined), /gov-1\.2\.3-<arch>\.msi/);
});

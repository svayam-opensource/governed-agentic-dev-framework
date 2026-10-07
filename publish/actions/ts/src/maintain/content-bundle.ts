// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * THE CONTENT GOV CARRIES (Policy Owner, 2026-10-07, option B — rule-model-design.md "gov carries its content").
 *
 * The gov package BUNDLES the framework content it was built with: `publish/content` from the same tree, copied
 * into the package at build time (`lib/content-bundle.json`, written by scripts/write-build-identity.mjs). Client
 * and content are one artifact, so they match by construction — `gov setup` seeds from it and `gov upgrade`
 * defaults to it, with nothing to fetch and no commit to record. A gov built without `.git` (the local install
 * site's image) carries its content like any other.
 *
 * WHY ONE FILE, NOT A DIRECTORY. npm never ships a file named `.gitignore` — and applies one it finds as ignore
 * rules for its directory. The content ships a `.gitignore` the manifest installs, so a copied directory would
 * lose it silently and the package's content would no longer be the build's. A single JSON file is immune to every
 * packing rule; it is materialized into a temporary directory when used.
 *
 * WHAT IS BUNDLED: MANIFEST.yaml and every file a MANIFEST `src` row covers — the framework content, nothing else.
 * Editor and OS litter (.DS_Store, swap files, node_modules) under a covered directory is not content either.
 */
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { parseManifest } from "./upgrade-sync.js";

/** Where the build writes the bundle, relative to the package root (inside `lib/`, so it ships). */
export const CONTENT_BUNDLE_PATH = "lib/content-bundle.json";

export interface ContentEntry {
  readonly path: string;
  readonly bytes: Buffer;
}

interface StoredEntry { readonly path: string; readonly text?: string; readonly base64?: string }
interface StoredBundle { readonly format: 1; readonly files: readonly StoredEntry[] }

/** Never content, wherever it appears: VCS and package-manager state, OS and editor litter. */
const SKIP_DIRS = new Set([".git", "node_modules"]);
const JUNK = (name: string): boolean => name === ".DS_Store" || name === "Thumbs.db" || /\.sw[op]$/.test(name) || name.endsWith("~");

/** Every file under `dir`, relative and sorted — .git, node_modules and OS/editor litter skipped. */
export function treeFiles(dir: string, rel = ""): string[] {
  const out: string[] = [];
  for (const name of fs.readdirSync(path.join(dir, rel)).sort()) {
    if (SKIP_DIRS.has(name) || JUNK(name)) continue;
    const r = rel ? `${rel}/${name}` : name;
    const st = fs.statSync(path.join(dir, r));
    if (st.isDirectory()) out.push(...treeFiles(dir, r));
    else if (st.isFile()) out.push(r);
  }
  return out.sort();
}

/**
 * sha256 over the sorted `path NUL sha256(bytes)` lines. CRLF is read as LF: a Windows checkout with autocrlf
 * holds the same content, not a different build.
 */
export function fingerprintEntries(entries: readonly ContentEntry[]): string {
  const h = crypto.createHash("sha256");
  for (const e of [...entries].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))) {
    const normalised = e.bytes.includes(13) ? Buffer.from(e.bytes.toString("latin1").replace(/\r\n/g, "\n"), "latin1") : e.bytes;
    h.update(`${e.path}\0${crypto.createHash("sha256").update(normalised).digest("hex")}\n`);
  }
  return `sha256:${h.digest("hex")}`;
}

/** The framework content of a `publish/content` directory: MANIFEST.yaml plus every file a `src` row covers. */
export function selectContentFiles(contentDir: string): string[] {
  const manifest = parseManifest(fs.readFileSync(path.join(contentDir, "MANIFEST.yaml"), "utf8"));
  const srcs = manifest.files.map((f) => f.src);
  const covered = (f: string): boolean => f === "MANIFEST.yaml" || srcs.some((s) => (s.endsWith("/") ? f.startsWith(s) : f === s));
  return treeFiles(contentDir).filter(covered);
}

/** Read the framework content of `contentDir` as entries — what the bundle holds. */
export function readContentEntries(contentDir: string): ContentEntry[] {
  return selectContentFiles(contentDir).map((p) => ({ path: p, bytes: fs.readFileSync(path.join(contentDir, p)) }));
}

/** Write the bundle of `contentDir` to `file`; returns the entries written. */
export function writeContentBundle(contentDir: string, file: string): ContentEntry[] {
  const entries = readContentEntries(contentDir);
  const files: StoredEntry[] = entries.map((e) => {
    const text = e.bytes.toString("utf8");
    return Buffer.from(text, "utf8").equals(e.bytes) ? { path: e.path, text } : { path: e.path, base64: e.bytes.toString("base64") };
  });
  const bundle: StoredBundle = { format: 1, files };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(bundle)}\n`);
  return entries;
}

/** The entries of a bundle file. Throws on a file that is not one (the caller says what that means). */
export function readContentBundle(file: string): ContentEntry[] {
  const raw = JSON.parse(fs.readFileSync(file, "utf8")) as Partial<StoredBundle>;
  if (raw.format !== 1 || !Array.isArray(raw.files)) throw new Error(`${file} is not a gov content bundle`);
  return raw.files.map((f) => {
    if (typeof f.path !== "string" || f.path.startsWith("/") || f.path.split("/").includes("..")) throw new Error(`${file}: bad path ${String(f.path)}`);
    return { path: f.path, bytes: typeof f.text === "string" ? Buffer.from(f.text, "utf8") : Buffer.from(f.base64 ?? "", "base64") };
  });
}

/** Write a bundle's files into a fresh temporary directory; `cleanup` removes it. */
export function materializeContentBundle(file: string): { contentDir: string; cleanup: () => void } {
  const entries = readContentBundle(file);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "gov-bundled-content-"));
  const cleanup = (): void => fs.rmSync(tmp, { recursive: true, force: true });
  try {
    for (const e of entries) {
      const dst = path.join(tmp, e.path);
      fs.mkdirSync(path.dirname(dst), { recursive: true });
      fs.writeFileSync(dst, e.bytes);
    }
  } catch (err) { cleanup(); throw err; }
  return { contentDir: tmp, cleanup };
}

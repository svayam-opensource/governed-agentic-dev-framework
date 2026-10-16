// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * BUILD IDENTITY — which framework content this gov was built with (adoption walk #9, 2026-10-07).
 *
 * THE FAILURE. A gov built from a feature branch ran `gov upgrade`, which fetched content from `main`. The only
 * guard compared versions — "CLI 1.2.3 == content 1.2.3" — and passed, because neither side had bumped. The two
 * builds disagreed about org-config.yaml's mode, and the org's filled file became the blank template (#13).
 * A version is a label someone has to remember to change; it cannot tell two builds apart.
 *
 * THE IDENTITY. A CONTENT FINGERPRINT — sha256 over every content file's path and bytes — recorded at build time
 * in `lib/build-identity.json`, beside the commit the build came from when there is one. The fingerprint is what
 * is checked: it identifies the bytes whether they arrive bundled, by git fetch or `--from` a directory, and two
 * commits that differ only in CLI code carry the same content and pass.
 *
 * THE CONTENT IS CARRIED (Policy Owner, 2026-10-07, option B). The package bundles the content it was built with
 * (content-bundle.ts), and the fingerprint is computed over exactly that bundle. With no `--ref`/`--from`, setup
 * and upgrade use it — no fetch, and no commit needed: a build outside git (the local install site's image)
 * carries its content like any other. The commit is recorded when known, as information, never as a requirement.
 *
 * Run from a source checkout (tsx, no build file), the identity is the checkout's own `publish/content`, and that
 * directory is the default content — a developer's gov always matches the tree it runs from.
 *
 * NO ESCAPE HATCH. Every legitimate content for a gov is reachable: its bundle, `--ref <its commit>` or
 * `--from <its content>`. A flag to combine mismatched builds would be the exact precondition of #13, made a habit.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { CONTENT_BUNDLE_PATH, fingerprintEntries, materializeContentBundle, readContentEntries, treeFiles, writeContentBundle } from "./content-bundle.js";
import { DEFAULT_TEMPLATE } from "./upgrade-run.js";

/** Where the build writes the identity, relative to the package root (inside `lib/`, so it ships). */
export const BUILD_IDENTITY_PATH = "lib/build-identity.json";

export interface BuildIdentity {
  readonly version: string;
  /** The commit the build came from, when it came from git — information for a refusal, never required. */
  readonly commit: string | null;
  /** The build's content had uncommitted changes: the commit alone does not hold this content. */
  readonly dirty: boolean;
  /** `sha256:<hex>` over the content tree — the identity that is CHECKED. */
  readonly contentFingerprint: string;
  /** `build`: read from the build file. `checkout`: computed live from a source checkout's own content. */
  readonly source: "build" | "checkout";
  /** `checkout` only: the content directory itself — the default content, no fetch. */
  readonly contentDir?: string;
  /** `build` only: the content bundle this gov carries — the default content, no fetch. */
  readonly bundle?: string;
}

/**
 * sha256 over the sorted `path NUL sha256(bytes)` lines of the FRAMEWORK CONTENT under `dir`: MANIFEST.yaml and
 * every file a `src` row covers — exactly what a bundle holds (content-bundle.ts), so the content a gov carries,
 * the same commit fetched with `--ref`, and the checkout it was built from all fingerprint alike. A file the
 * manifest does not ship never reaches an organization and is not part of the identity. Without a MANIFEST, every
 * file. .git, node_modules and OS/editor litter are skipped; CRLF is read as LF (autocrlf is the same content).
 */
export function contentFingerprint(dir: string): string {
  if (fs.existsSync(path.join(dir, "MANIFEST.yaml"))) return fingerprintEntries(readContentEntries(dir));
  return fingerprintEntries(treeFiles(dir).map((p) => ({ path: p, bytes: fs.readFileSync(path.join(dir, p)) })));
}

/**
 * Record the identity at build time (scripts/write-build-identity.mjs): bundle the content into the package, and
 * fingerprint exactly what was bundled.
 */
export function writeBuildIdentity(pkgRoot: string, contentDir: string, at: { version: string; commit: string | null; dirty: boolean }): BuildIdentity & { files: number } {
  const bundle = path.join(pkgRoot, CONTENT_BUNDLE_PATH);
  const entries = writeContentBundle(contentDir, bundle);
  const id: BuildIdentity = { version: at.version, commit: at.commit, dirty: at.dirty, contentFingerprint: fingerprintEntries(entries), source: "build", bundle };
  const file = path.join(pkgRoot, BUILD_IDENTITY_PATH);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const { source: _source, bundle: _bundle, ...stored } = id;
  fs.writeFileSync(file, `${JSON.stringify(stored, null, 2)}\n`);
  return { ...id, files: entries.length };
}

/**
 * The identity of the gov whose package root is `pkgRoot`: the build file (and the bundle beside it) when there is
 * one, else — run from a source checkout — the checkout's own `publish/content` (two levels up from
 * `publish/actions/ts`). null when neither: a gov that cannot say what it was built with.
 */
export function readBuildIdentity(pkgRoot: string, opts: { built?: boolean } = {}): BuildIdentity | null {
  // Running from SOURCE (tsx), a build file left by an earlier `npm run build` describes an older tree, not this one.
  if (opts.built !== false) try {
    const raw = JSON.parse(fs.readFileSync(path.join(pkgRoot, BUILD_IDENTITY_PATH), "utf8")) as Partial<BuildIdentity>;
    if (typeof raw.contentFingerprint === "string" && raw.contentFingerprint) {
      const bundle = path.join(pkgRoot, CONTENT_BUNDLE_PATH);
      return {
        version: raw.version ?? "unknown", commit: raw.commit ?? null, dirty: raw.dirty === true, contentFingerprint: raw.contentFingerprint, source: "build",
        ...(fs.existsSync(bundle) ? { bundle } : {}),
      };
    }
  } catch { /* no build file — a source checkout, or an install that predates build identity */ }
  const checkout = path.resolve(pkgRoot, "..", "..", "content");
  if (!fs.existsSync(path.join(checkout, "MANIFEST.yaml"))) return null;
  return { version: "checkout", commit: null, dirty: false, contentFingerprint: contentFingerprint(checkout), source: "checkout", contentDir: checkout };
}

const short = (fp: string): string => fp.replace(/^sha256:/, "").slice(0, 12);

function versionOf(dir: string): string {
  try { return fs.readFileSync(path.join(dir, "VERSION"), "utf8").split(/\r?\n/)[0]!.trim() || "unknown"; }
  catch { return "unknown"; /* content without a VERSION marker: say so in the refusal, do not stop on it */ }
}

export type IdentityCheck = { readonly ok: true } | { readonly ok: false; readonly lines: readonly string[] };

/**
 * WHO IS ASKING — the command whose content is being chosen, as a person would re-type it: `gov upgrade`, or
 * `gov setup acme/acme-gov`. Every refusal's advice is built from it, so it can only offer flags that command
 * accepts (F21: setup printed `--ref`, which setup did not take). A test parses every piece of advice.
 */
export interface Invocation {
  readonly verb: "upgrade" | "setup";
  /** The command line to re-type, without flags: `gov upgrade`, `gov setup acme/acme-gov`. */
  readonly line: string;
}
export const UPGRADE: Invocation = { verb: "upgrade", line: "gov upgrade" };

const nothing = (inv: Invocation): string => (inv.verb === "setup" ? "Nothing was seeded." : "Nothing was written.");

/**
 * Is the content at `contentDir` the build this gov expects? `label` says where it came from (`--from <dir>`,
 * `<url>@<ref>`), `contentCommit` the commit it was fetched at, when known.
 */
export function checkContentIdentity(expected: BuildIdentity | null, contentDir: string, label: string, contentCommit?: string | null, inv: Invocation = UPGRADE): IdentityCheck {
  if (expected === null) {
    return { ok: false, lines: [
      `gov ${inv.verb}: refused — this gov does not know which content it was built with, so it cannot tell whether this content matches. ${nothing(inv)}`,
      `  Reinstall gov from a current build (it carries its content), then run ${inv.line} again.`,
    ] };
  }
  const got = contentFingerprint(contentDir);
  if (got === expected.contentFingerprint) return { ok: true };
  const mine = expected.source === "checkout"
    ? `this gov runs from a source checkout whose content is ${short(expected.contentFingerprint)} (${expected.contentDir})`
    : `this gov (${expected.version}) was built with content ${short(expected.contentFingerprint)}${expected.commit ? ` from commit ${expected.commit.slice(0, 12)}${expected.dirty ? " plus uncommitted content changes" : ""}` : ""}`;
  const own = expected.source === "checkout" || expected.bundle !== undefined;
  const fix = own
    ? `  · use the content this gov carries — no --ref, no --from:  ${inv.line}`
    : expected.commit && !expected.dirty
      ? `  · use the content this gov was built with:  ${inv.line} --ref ${expected.commit}`
      : `  · use the content this gov was built with:  ${inv.line} --from <the publish/content it was built from>`;
  return { ok: false, lines: [
    `gov ${inv.verb}: refused — this content is not the build this gov expects. ${nothing(inv)}`,
    `  ${mine}`,
    `  ${label} holds content ${short(got)} (VERSION ${versionOf(contentDir)}${contentCommit ? `, commit ${contentCommit.slice(0, 12)}` : ""})`,
    "  A matching VERSION does not make them the same build: the version is a label, the fingerprint is the bytes.",
    "  Fix — either:",
    `  · install the gov built from that content, then run ${inv.line} again, or`,
    fix,
  ] };
}

export type Fetch = (templateUrl: string, ref: string) => { contentDir: string; cleanup: () => void; commit?: string | null };
export type SelectedContent =
  | { readonly ok: true; readonly contentDir: string; readonly cleanup: () => void; readonly label: string }
  | { readonly ok: false; readonly lines: readonly string[] };
export interface ContentFlags { readonly from?: string; readonly ref?: string; readonly template?: string }

/**
 * WHICH CONTENT `gov setup` AND `gov upgrade` USE, AND WHETHER IT IS THIS GOV'S BUILD.
 *
 *   --from <dir>          that directory
 *   --ref / --template    fetched from the template at that ref (default template: the published repo)
 *   neither, checkout     the checkout's own content — no fetch
 *   neither, built        the content this gov carries (its bundle) — no fetch, no commit needed
 *
 * Whatever is chosen is checked against the build identity; a mismatch is refused before anything is written.
 * `fetch` throws on failure (the caller reports it).
 */
export function selectContent(identity: BuildIdentity | null, flags: ContentFlags, fetch: Fetch, inv: Invocation = UPGRADE): SelectedContent {
  let contentDir: string;
  let cleanup = (): void => {};
  let label: string;
  let commit: string | null | undefined;
  const overridden = flags.ref !== undefined || flags.template !== undefined;
  if (flags.from !== undefined) {
    contentDir = flags.from;
    label = `--from ${flags.from}`;
  } else if (!overridden && identity?.source === "checkout" && identity.contentDir) {
    contentDir = identity.contentDir;
    label = identity.contentDir;
  } else if (!overridden && identity?.bundle !== undefined) {
    try { ({ contentDir, cleanup } = materializeContentBundle(identity.bundle)); }
    catch (e) {
      return { ok: false, lines: [
        `gov ${inv.verb}: refused — the content this gov carries could not be read (${(e as Error).message}). ${nothing(inv)}`,
        `  Reinstall gov, then run ${inv.line} again — or name the content: ${inv.line} --ref <commit|tag|branch>, or ${inv.line} --from <dir>.`,
      ] };
    }
    label = `the content gov ${identity.version} carries`;
  } else if (!overridden) {
    return { ok: false, lines: [
      `gov ${inv.verb}: refused — this gov does not carry its framework content (no ${CONTENT_BUNDLE_PATH}). ${nothing(inv)}`,
      `  Reinstall gov, then run ${inv.line} again — or name the content: ${inv.line} --ref <commit|tag|branch>, or ${inv.line} --from <dir>.`,
    ] };
  } else {
    const ref = flags.ref ?? identity?.commit ?? null;
    if (ref === null) {
      return { ok: false, lines: [
        `gov ${inv.verb}: refused — a template names where to fetch from, not what: this gov recorded no commit to fetch there. ${nothing(inv)}`,
        `  Name it: ${inv.line} --ref <commit|tag|branch>, or ${inv.line} --from <dir> — or name no template, to use the content this gov carries.`,
      ] };
    }
    const template = flags.template ?? DEFAULT_TEMPLATE;
    const fetched = fetch(template, ref);
    ({ contentDir, cleanup } = fetched);
    commit = fetched.commit;
    label = `${template}@${ref}`;
  }
  const check = checkContentIdentity(identity, contentDir, label, commit, inv);
  if (!check.ok) { cleanup(); return check; }
  return { ok: true, contentDir, cleanup, label };
}

/** `gov upgrade`'s content — `selectContent` under its own name, kept for its callers. */
export const selectUpgradeContent = (identity: BuildIdentity | null, flags: ContentFlags, fetch: Fetch): SelectedContent => selectContent(identity, flags, fetch, UPGRADE);

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
 * in `lib/build-identity.json`, beside the commit the build came from. The fingerprint is what is checked: it
 * identifies the bytes the client was built against whether they arrive by git fetch, a tarball or `--from` a
 * directory, and two commits that differ only in CLI code carry the same content and pass. The commit is what is
 * FETCHED by default (`gov upgrade` with no `--ref`), and what the refusal tells a person to pass.
 *
 * Run from a source checkout (tsx, no build file), the identity is the checkout's own `publish/content`, and that
 * directory is the default content — a developer's gov always matches the tree it runs from.
 *
 * NO ESCAPE HATCH. Every legitimate content for a gov is reachable: `--ref <its commit>` or `--from <its content>`.
 * A flag to combine mismatched builds would be the exact precondition of #13, made a habit.
 */
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { DEFAULT_TEMPLATE } from "./upgrade-run.js";

/** Where the build writes the identity, relative to the package root (inside `lib/`, so it ships). */
export const BUILD_IDENTITY_PATH = "lib/build-identity.json";

export interface BuildIdentity {
  readonly version: string;
  /** The commit the build came from — the default content ref. null when the build was outside git. */
  readonly commit: string | null;
  /** The build's content had uncommitted changes: the commit alone does not hold this content. */
  readonly dirty: boolean;
  /** `sha256:<hex>` over the content tree — the identity that is CHECKED. */
  readonly contentFingerprint: string;
  /** `build`: read from the build file. `checkout`: computed live from a source checkout's own content. */
  readonly source: "build" | "checkout";
  /** `checkout` only: the content directory itself — the default content, no fetch. */
  readonly contentDir?: string;
}

const SKIP = new Set([".git", "node_modules"]);

function files(root: string, rel = ""): string[] {
  const out: string[] = [];
  for (const name of fs.readdirSync(path.join(root, rel)).sort()) {
    if (SKIP.has(name)) continue;
    const r = rel ? `${rel}/${name}` : name;
    const st = fs.statSync(path.join(root, r));
    if (st.isDirectory()) out.push(...files(root, r));
    else if (st.isFile()) out.push(r);
  }
  return out;
}

/**
 * sha256 over the sorted `path NUL sha256(bytes)` lines of every file under `dir` (.git and node_modules skipped).
 * CRLF is read as LF: a Windows checkout with autocrlf holds the same content, not a different build.
 */
export function contentFingerprint(dir: string): string {
  const h = crypto.createHash("sha256");
  for (const rel of files(dir).sort()) {
    const bytes = fs.readFileSync(path.join(dir, rel));
    const normalised = bytes.includes(13) ? Buffer.from(bytes.toString("latin1").replace(/\r\n/g, "\n"), "latin1") : bytes;
    h.update(`${rel}\0${crypto.createHash("sha256").update(normalised).digest("hex")}\n`);
  }
  return `sha256:${h.digest("hex")}`;
}

/** Record the identity at build time (scripts/write-build-identity.mjs). */
export function writeBuildIdentity(pkgRoot: string, contentDir: string, at: { version: string; commit: string | null; dirty: boolean }): BuildIdentity {
  const id: BuildIdentity = { version: at.version, commit: at.commit, dirty: at.dirty, contentFingerprint: contentFingerprint(contentDir), source: "build" };
  const file = path.join(pkgRoot, BUILD_IDENTITY_PATH);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const { source: _source, ...stored } = id;
  fs.writeFileSync(file, `${JSON.stringify(stored, null, 2)}\n`);
  return id;
}

/**
 * The identity of the gov whose package root is `pkgRoot`: the build file when there is one, else — run from a
 * source checkout — the checkout's own `publish/content` (two levels up from `publish/actions/ts`). null when
 * neither: a gov that cannot say what it was built with.
 */
export function readBuildIdentity(pkgRoot: string, opts: { built?: boolean } = {}): BuildIdentity | null {
  // Running from SOURCE (tsx), a build file left by an earlier `npm run build` describes an older tree, not this one.
  if (opts.built !== false) try {
    const raw = JSON.parse(fs.readFileSync(path.join(pkgRoot, BUILD_IDENTITY_PATH), "utf8")) as Partial<BuildIdentity>;
    if (typeof raw.contentFingerprint === "string" && raw.contentFingerprint) {
      return { version: raw.version ?? "unknown", commit: raw.commit ?? null, dirty: raw.dirty === true, contentFingerprint: raw.contentFingerprint, source: "build" };
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
 * Is the content at `contentDir` the build this gov expects? `label` says where it came from (`--from <dir>`,
 * `<url>@<ref>`), `contentCommit` the commit it was fetched at, when known.
 */
export function checkContentIdentity(expected: BuildIdentity | null, contentDir: string, label: string, contentCommit?: string | null): IdentityCheck {
  if (expected === null) {
    return { ok: false, lines: [
      "gov upgrade: refused — this gov does not know which content it was built with, so it cannot tell whether this content matches. Nothing was written.",
      "  Reinstall gov from a current build (it records its content), then run gov upgrade again.",
    ] };
  }
  const got = contentFingerprint(contentDir);
  if (got === expected.contentFingerprint) return { ok: true };
  const mine = expected.source === "checkout"
    ? `this gov runs from a source checkout whose content is ${short(expected.contentFingerprint)} (${expected.contentDir})`
    : `this gov (${expected.version}) was built with content ${short(expected.contentFingerprint)}${expected.commit ? ` from commit ${expected.commit.slice(0, 12)}${expected.dirty ? " plus uncommitted content changes" : ""}` : ""}`;
  const fixRef = expected.source === "checkout"
    ? `  · upgrade from the content this gov runs with:  gov upgrade --from ${expected.contentDir}`
    : expected.commit && !expected.dirty
      ? `  · upgrade from the content this gov was built with:  gov upgrade --ref ${expected.commit}   (or --from <that content dir>)`
      : `  · upgrade from the content this gov was built with:  gov upgrade --from <the publish/content it was built from>`;
  return { ok: false, lines: [
    "gov upgrade: refused — this content is not the build this gov expects. Nothing was written.",
    `  ${mine}`,
    `  ${label} holds content ${short(got)} (VERSION ${versionOf(contentDir)}${contentCommit ? `, commit ${contentCommit.slice(0, 12)}` : ""})`,
    "  A matching VERSION does not make them the same build: the version is a label, the fingerprint is the bytes.",
    "  Fix — either:",
    "  · install the gov built from that content, then run gov upgrade again, or",
    fixRef,
  ] };
}

export type Fetch = (templateUrl: string, ref: string) => { contentDir: string; cleanup: () => void; commit?: string | null };
export type SelectedContent =
  | { readonly ok: true; readonly contentDir: string; readonly cleanup: () => void; readonly label: string }
  | { readonly ok: false; readonly lines: readonly string[] };

/**
 * WHICH CONTENT `gov upgrade` USES, AND WHETHER IT IS THIS GOV'S BUILD.
 *
 *   --from <dir>          that directory
 *   --ref / --template    fetched from the template at that ref (default template: the published repo)
 *   neither, checkout     the checkout's own content — no fetch
 *   neither, built        fetched at the commit this gov was built from — never `main`
 *
 * Whatever is chosen is checked against the build identity; a mismatch is refused before anything is written.
 * `fetch` throws on failure (the caller reports it).
 */
export function selectUpgradeContent(identity: BuildIdentity | null, flags: { from?: string; ref?: string; template?: string }, fetch: Fetch): SelectedContent {
  let contentDir: string;
  let cleanup = (): void => {};
  let label: string;
  let commit: string | null | undefined;
  if (flags.from !== undefined) {
    contentDir = flags.from;
    label = `--from ${flags.from}`;
  } else if (flags.ref === undefined && flags.template === undefined && identity?.source === "checkout" && identity.contentDir) {
    contentDir = identity.contentDir;
    label = identity.contentDir;
  } else {
    const ref = flags.ref ?? identity?.commit ?? null;
    if (ref === null) {
      return { ok: false, lines: [
        "gov upgrade: this gov did not record the commit it was built from, so there is no default content to fetch.",
        "  Pass the content this gov was built with: --ref <commit> (or a tag), or --from <content dir>.",
      ] };
    }
    const template = flags.template ?? DEFAULT_TEMPLATE;
    let fetched: ReturnType<Fetch>;
    try { fetched = fetch(template, ref); }
    catch (e) {
      if (flags.ref !== undefined) throw e;
      // The default ref is this gov's own commit — which a build from an unpushed branch has and the remote lacks.
      throw new Error(`${(e as Error).message}\n  This gov was built from commit ${ref}; if ${template} does not have it, pass the content it was built with: --from <its publish/content>.`, { cause: e });
    }
    ({ contentDir, cleanup } = fetched);
    commit = fetched.commit;
    label = `${template}@${ref}`;
  }
  const check = checkContentIdentity(identity, contentDir, label, commit);
  if (!check.ok) { cleanup(); return check; }
  return { ok: true, contentDir, cleanup, label };
}

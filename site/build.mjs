#!/usr/bin/env node
// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * Build the install site for one environment (#231).
 *
 *   node site/build.mjs prod --verify        → site/dist/prod/
 *   node site/build.mjs dev                  → site/dist/dev/
 *
 * ── TWO SOURCES, ON PURPOSE ──────────────────────────────────────────────────────────────────────
 *
 * The page and the installer change for different reasons and must not be chained together:
 *
 *   · the PAGE comes from the working tree — whatever branch is being deployed. A copy fix ships on
 *     merge.
 *   · the INSTALLER comes from the PINNED REF, read with `git show <ref>:install.sh`. Its bytes are
 *     the release's bytes no matter what is checked out.
 *
 * Reading the installer from the working tree (the first version of this script) coupled them: a CSS
 * typo on the production page would have required cutting a release tag, and the "pin" was only ever
 * as honest as whatever CI happened to check out. Now `--verify` asserts the served script differs
 * from the ref's script by EXACTLY the two pinned lines — which is a claim about the artefact rather
 * than a claim about the build.
 *
 * ── WHAT THIS EXISTS TO PREVENT ──────────────────────────────────────────────────────────────────
 *
 * The adopter-facing command fetches /install.sh and runs it, so the worst outcome is a host answering
 * with HTML — a redirect notice, a 404, a framework's client-side router — handed to a shell. Silent
 * and baffling. Hence: plain files beside the page, `spa: false` on the catalog unit, and an assertion
 * that the first bytes are a shebang. The page's primary command is fetch-then-run, never
 * `curl … | bash`: piped, a failed download exits 0 (docs/installing.md), and `--verify` asserts it.
 *
 * ── WHAT IS DERIVED, NOT DECLARED ────────────────────────────────────────────────────────────────
 *
 * The hostname. gov derives a unit's DN per environment from `app_domain` (prod bare, else
 * `-<env>`), so this script applies the same rule rather than reading a list of hosts that could
 * drift from it. See svm-prj-work:knowledge/deployment/specs/public-dn-convention.md.
 */
import { readFileSync, writeFileSync, mkdirSync, rmSync, copyFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, "..");
const REPO_URL = "https://github.com/svayam-opensource/governed-agentic-dev-framework";

/**
 * Fail, and leave NO partial output behind.
 *
 * The first version of this wrote the page, then failed pinning the installer, and left a `dist/`
 * containing an index.html and no install.sh — a directory that deploys cleanly and serves a page
 * whose install command 404s. Which is the same defect class this whole file is about: a partial
 * result that looks finished. So the output directory is removed on every failure path.
 */
let OUT_DIR = null;
function die(msg) {
  if (OUT_DIR) {
    rmSync(OUT_DIR, { recursive: true, force: true });
    console.error(`\n  removed the partial output at ${OUT_DIR}`);
  }
  console.error(`\nbuild FAILED: ${msg}`);
  process.exit(1);
}

const cfg = JSON.parse(readFileSync(join(HERE, "envs.json"), "utf8"));
const args = process.argv.slice(2);
const envName = args.find((a) => !a.startsWith("--"));
const verify = args.includes("--verify");
if (!envName || !cfg.envs[envName]) {
  console.error(`usage: node site/build.mjs <${Object.keys(cfg.envs).join("|")}> [--verify]`);
  process.exit(2);
}
const env = cfg.envs[envName];

/** The DN gov would derive: prod is bare, every other env carries `-<env>`. */
const dnFor = (e) => (e === "prod" ? `${cfg.app_domain}.${cfg.base}` : `${cfg.app_domain}-${e}.${cfg.base}`);
const host = dnFor(envName);
const out = join(HERE, "dist", envName);

/**
 * A file as it exists at a REF, not as it exists on disk.
 *
 * Tries the ref as given, then `origin/<ref>` — a CI checkout usually has the remote ref but not a
 * local branch of the same name, and failing on that would make every deploy need a bespoke fetch.
 * A missing ref is fatal: serving the working tree's installer while claiming to serve a tag is
 * precisely the dishonesty this function was added to remove.
 */
function readAtRef(ref, relPath) {
  for (const candidate of [ref, `origin/${ref}`]) {
    const r = spawnSync("git", ["-C", REPO_ROOT, "show", `${candidate}:${relPath}`], { encoding: "utf8" });
    if (r.status === 0) return { text: r.stdout, resolved: candidate };
  }
  die(
    `cannot read ${relPath} at ref '${ref}' (nor origin/${ref}).\n` +
    `  The site must serve the installer from the pinned ref, not from the working tree.\n` +
    `  Either cut that ref, or correct 'ref' for this environment in site/envs.json.`,
  );
}

/** Replace exactly one occurrence, or fail. A pin that did not apply must never reach a host. */
function pin(text, pattern, replacement, what) {
  const hits = text.match(pattern);
  if (!hits) die(`could not pin ${what} — no line matched ${pattern}.\n  The installer changed shape. Fix this build script rather than shipping an unpinned site.`);
  if (hits.length > 1) die(`could not pin ${what} — ${hits.length} lines matched ${pattern}, so the intended one is ambiguous.`);
  return text.replace(pattern, replacement);
}

/**
 * A RELEASE IS gov's TAG, `gov-work-<semver>` — cut by `gov promote gov-work --to prod` at the commit the
 * published artifact was built from (Svayamtech/910-GOV-CICD#274). There is no other release mechanism
 * (framework decision 2026-09-17: one path, gov), so a `v*` tag names nothing and is refused.
 */
const RELEASE_TAG = /^gov-work-(\d+\.\d+\.\d+)$/;
function releaseVersion(tag) {
  const m = RELEASE_TAG.exec(tag);
  if (!m) die(`'${tag}' in versioned is not a gov release tag (gov-work-<semver>). Releases are cut by gov promote, never by hand.`);
  return m[1];
}

const RE_URL = /^GOV_INSTALL_URL="\$\{GOV_INSTALL_URL:-[^"]*"$/m;
const RE_PKG = /^GOV_PKG="\$\{GOV_PKG:-[^"]*"$/m;

/** The installer as served: the ref's bytes, with exactly the two pins applied. */
function installerFor(ref, pkg, urlPath, hostName) {
  const { text, resolved } = readAtRef(ref, "install.sh");
  let sh = pin(text, RE_URL, `GOV_INSTALL_URL="\${GOV_INSTALL_URL:-https://${hostName}${urlPath}}"`, "GOV_INSTALL_URL");
  sh = pin(sh, RE_PKG, `GOV_PKG="\${GOV_PKG:-${pkg}}"`, "GOV_PKG");
  return { sh, source: text, resolved };
}

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
OUT_DIR = out;   // from here on, any failure takes the directory with it

// ── the page ────────────────────────────────────────────────────────────────────────────────────
const banner = env.label ? `<div class="envbar">${env.label}</div>` : "";
const versionedList = (cfg.versioned ?? [])
  .map((v) => `<li><a href="./v/${releaseVersion(v)}/install.sh">${releaseVersion(v)}</a></li>`)
  .join("\n        ");
const html = readFileSync(join(HERE, "template", "index.html"), "utf8")
  .replaceAll("{{HOST}}", host)
  .replaceAll("{{REF}}", env.ref)
  .replaceAll("{{PKG}}", env.pkg)
  .replaceAll("{{REPO}}", REPO_URL)
  .replaceAll("{{ROBOTS}}", env.robots)
  .replaceAll("{{BUILT}}", new Date().toISOString().slice(0, 10))
  .replaceAll("{{ENV_BANNER}}", banner)
  .replaceAll("{{VERSIONED}}", versionedList);
writeFileSync(join(out, "index.html"), html);
copyFileSync(join(HERE, "template", "style.css"), join(out, "style.css"));

// ── the current pair, at the root ────────────────────────────────────────────────────────────────
const current = installerFor(env.ref, env.pkg, "/install.sh", host);
writeFileSync(join(out, "install.sh"), current.sh);

const ps1src = readAtRef(env.ref, "install.ps1");
writeFileSync(join(out, "install.ps1"), pin(ps1src.text,
  /^#\s+irm https:\/\/\S+install\.ps1 \| iex$/m,
  `#   irm https://${host}/install.ps1 | iex`, "the install.ps1 self-reference"));

// ── VERSIONED PAIRS (#231, Q6) ──────────────────────────────────────────────────────────────────
//
// "Install a previous version of the framework" means the script and client that were TESTED
// TOGETHER, not a new script with an old client — which install.sh does not support honestly: it
// calls `gov doctor --fix` behind `|| true`, so an older client silently skips steps rather than
// saying it cannot do them. So each versioned path serves that release's OWN script pinned to that
// release's OWN client. nvm's `/v<version>/install.sh` is the precedent.
const versionedBuilt = [];
for (const v of cfg.versioned ?? []) {
  const bare = releaseVersion(v);
  const dir = join(out, "v", bare);
  mkdirSync(dir, { recursive: true });
  const built = installerFor(v, `@svayam-opensource/gov@${bare}`, `/v/${bare}/install.sh`, host);
  writeFileSync(join(dir, "install.sh"), built.sh);
  writeFileSync(join(dir, "install.ps1"), readAtRef(v, "install.ps1").text);
  versionedBuilt.push({ v, resolved: built.resolved });
}

writeFileSync(join(out, "CNAME"), `${host}\n`);
writeFileSync(join(out, ".nojekyll"), "");
writeFileSync(join(out, "robots.txt"), env.robots.startsWith("noindex")
  ? "User-agent: *\nDisallow: /\n"
  : `User-agent: *\nAllow: /\nSitemap: https://${host}/\n`);

console.log(`built ${envName} → site/dist/${envName}`);
console.log(`  host ${host} (derived) · script from ${current.resolved} · installs ${env.pkg}`);
for (const b of versionedBuilt) console.log(`  versioned /v/${releaseVersion(b.v)}/install.sh ← ${b.resolved}`);

// ── --verify ────────────────────────────────────────────────────────────────────────────────────
if (verify) {
  const fail = [];
  const shOut = readFileSync(join(out, "install.sh"), "utf8");
  const psOut = readFileSync(join(out, "install.ps1"), "utf8");

  // THE ONE THAT MATTERS: a shell must receive a script, never a web page.
  if (!shOut.startsWith("#!")) fail.push("install.sh does not begin with a shebang");
  for (const [name, body] of [["install.sh", shOut], ["install.ps1", psOut]]) {
    if (/^\s*<(!doctype|html)/i.test(body)) fail.push(`${name} looks like HTML`);
  }

  // THE STRONG CLAIM: the served installer is the REF's installer, differing by exactly the two
  // pinned lines. This is what makes the pin a property of the artefact rather than of the build.
  const a = current.source.split("\n");
  const b = shOut.split("\n");
  if (a.length !== b.length) {
    fail.push(`served install.sh has ${b.length} lines, the ref's has ${a.length} — it is not the ref's script`);
  } else {
    const differing = a.map((l, i) => (l === b[i] ? null : i)).filter((i) => i !== null);
    if (differing.length !== 2) {
      fail.push(`served install.sh differs from ${env.ref} on ${differing.length} line(s); exactly 2 (the pins) are expected`);
    } else if (!differing.every((i) => RE_URL.test(a[i]) || RE_PKG.test(a[i]))) {
      fail.push(`served install.sh differs from ${env.ref} on a line that is NOT one of the two pins (lines ${differing.map((i) => i + 1).join(", ")})`);
    }
  }

  if (!shOut.includes(`https://${host}/install.sh`)) fail.push("install.sh was not pinned to the host");
  if (!shOut.includes(env.pkg)) fail.push(`install.sh was not pinned to ${env.pkg}`);
  if (shOut.includes("raw.githubusercontent.com/svayam-opensource/governed-agentic-dev-framework")) {
    fail.push("install.sh still carries a raw.githubusercontent URL for our own artefact");
  }
  if (!psOut.includes(`https://${host}/install.ps1`)) fail.push("install.ps1 was not pinned to the host");

  // PROD PINS SOMETHING THAT CANNOT MOVE. A branch name serves whatever lands on it next, which is the
  // `main` pin this site exists to replace (#231). A gov release tag, or a full commit sha where the
  // release predates the installer (1.2.2 was built from c05aa80, which has no install.sh).
  if (envName === "prod" && !(RELEASE_TAG.test(env.ref) || /^[0-9a-f]{40}$/.test(env.ref))) {
    fail.push(`prod pins '${env.ref}', which can move — pin a gov release tag (gov-work-<semver>) or a full commit sha`);
  }

  // Versioned pairs: each must pin its OWN version, never the environment's.
  for (const v of cfg.versioned ?? []) {
    const bare = releaseVersion(v);
    const p = join(out, "v", bare, "install.sh");
    if (!existsSync(p)) { fail.push(`missing /v/${bare}/install.sh`); continue; }
    const t = readFileSync(p, "utf8");
    if (!t.startsWith("#!")) fail.push(`/v/${bare}/install.sh does not begin with a shebang`);
    if (!t.includes(`@svayam-opensource/gov@${bare}`)) fail.push(`/v/${bare}/install.sh is not pinned to gov@${bare}`);
    if (!t.includes(`https://${host}/v/${bare}/install.sh`)) fail.push(`/v/${bare}/install.sh does not point its retry hint at itself`);
  }

  const page = readFileSync(join(out, "index.html"), "utf8");
  for (const needed of [host, env.ref, env.pkg]) {
    if (!page.includes(needed)) fail.push(`index.html does not state ${needed}`);
  }
  if (page.includes("{{")) fail.push("index.html has an unsubstituted {{TOKEN}}");
  // The copy button hands over whatever is in #cmd-unix. Piped into bash, a failed download exits 0.
  const primary = page.match(/<code id="cmd-unix">([^<]*)<\/code>/)?.[1] ?? "";
  if (!primary.includes("-o install.sh")) fail.push("the primary install command does not fetch to a file first");
  if (/\|\s*(GOV_YES=1\s+)?bash/.test(primary)) fail.push("the primary install command pipes curl into bash, which hides a failed download");
  if (env.label && !page.includes(env.label)) fail.push("a non-prod build is missing its environment banner");
  if (!env.label && page.includes("envbar")) fail.push("the prod build carries an environment banner");
  for (const f of ["index.html", "style.css", "install.sh", "install.ps1", "CNAME", "robots.txt"]) {
    if (!existsSync(join(out, f))) fail.push(`missing ${f}`);
  }

  if (fail.length) {
    console.error(`\nverify FAILED (${fail.length}):`);
    for (const f of fail) console.error(`  ✗ ${f}`);
    process.exit(1);
  }
  console.log(`  verify: served install.sh IS ${env.ref}'s, differing only in the two pins`);
}

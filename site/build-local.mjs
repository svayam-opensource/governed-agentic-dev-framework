#!/usr/bin/env node
// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * Build the LOCAL install site — your working tree, served on your machine (PRJ-121, 2026-09-21).
 *
 *   node site/build-local.mjs <tree-root> <client.tgz> [--verify]   → site/dist/local/
 *
 * `gov-cicd deploy gov-install --env local` gets here by passing `GOV_LOCAL=1` to the image build. It exists so
 * a change can be walked end to end BEFORE it goes anywhere:
 *
 *   docker run --rm -it rockylinux:9 bash
 *   curl -fsSL http://host.docker.internal:4002/install.sh -o install.sh && bash install.sh
 *
 * ── HOW THIS DIFFERS FROM build.mjs, AND WHY IT IS A SEPARATE FILE ────────────────────────────────
 *
 * build.mjs builds dev/uat/prod and REFUSES the working tree: an installer an adopter pipes into a shell must be
 * the pinned ref's bytes, never whatever a CI box happened to check out. That rule is right, and this file does
 * the opposite on purpose — for local, the working tree is the whole point. Keeping them apart means the rule
 * that protects adopters has no `if (local)` inside it to get wrong.
 *
 *   · install.sh / install.ps1  from <tree-root> — the worktree, not a ref
 *   · the client                 the tarball packed from <tree-root>/publish/actions/ts, served at /gov.tgz,
 *                                and GOV_PKG pinned to that URL — so the walk installs YOUR client, not @dev
 *   · the registry               none: GOV_PKG is a URL, and a URL is not a scoped package
 *
 * ── WHAT MUST NEVER HAPPEN ────────────────────────────────────────────────────────────────────────
 *
 * This variant reaching a shared host. Four independent reasons it cannot: only a LOCAL build receives
 * GOV_LOCAL=1 (gov-cicd engine); a local image has no registry, so it is never pushed; this script is the only
 * writer of dist/local; and Caddy routes it only for localhost, 127.0.0.1 and host.docker.internal.
 *
 * Reached from a walker container as host.docker.internal:4002 — Docker Desktop routes that to the host, where
 * gov-cicd binds the site to loopback. On native Linux docker it needs `--add-host=host.docker.internal:host-gateway`
 * AND a site bound beyond loopback; see docs/testing-the-adopter-path.md.
 */
import { readFileSync, writeFileSync, mkdirSync, rmSync, copyFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { PORT } from "./caddyfile.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, "dist", "local");
/** The names a local request arrives under: a browser on this machine, or a walker container. */
export const LOCAL_HOSTS = ["localhost", "127.0.0.1", "host.docker.internal"];
/** What the SERVED files say about themselves — the address a walker container reaches this site at. */
const SELF = `host.docker.internal:${PORT}`;

let wrote = false;
function die(msg) {
  // No partial output: a dist/local with a page and no install.sh deploys cleanly and serves a 404 on the one
  // command that matters — the same trap build.mjs guards against.
  if (wrote) { rmSync(OUT, { recursive: true, force: true }); console.error(`\n  removed the partial output at ${OUT}`); }
  console.error(`\nlocal build FAILED: ${msg}`);
  process.exit(1);
}

const args = process.argv.slice(2);
const verify = args.includes("--verify");
const [treeArg, tgzArg] = args.filter((a) => !a.startsWith("--"));
if (!treeArg || !tgzArg) {
  console.error("usage: node site/build-local.mjs <tree-root> <client.tgz> [--verify]");
  process.exit(2);
}
const tree = resolve(treeArg);
const tgz = resolve(tgzArg);
for (const f of ["install.sh", "install.ps1"]) {
  if (!existsSync(join(tree, f))) die(`${f} is not at ${tree} — <tree-root> must be the repository root (build.context: repo)`);
}
if (!existsSync(tgz)) die(`no client tarball at ${tgz} — pack publish/actions/ts first`);

/** Replace exactly one line, or refuse — the same contract as build.mjs's pin(). */
function pin(text, pattern, replacement, what) {
  const hits = text.match(new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : pattern.flags + "g"));
  if (!hits) die(`could not pin ${what} — no line matched ${pattern}. The installer changed shape; fix this script.`);
  if (hits.length > 1) die(`could not pin ${what} — ${hits.length} lines matched ${pattern}.`);
  return text.replace(pattern, replacement);
}
const RE_URL = /^GOV_INSTALL_URL="\$\{GOV_INSTALL_URL:-[^"]*"$/m;
const RE_PKG = /^GOV_PKG="\$\{GOV_PKG:-[^"]*"$/m;
const RE_PS1_SELF = /^#\s+irm https?:\/\/\S+install\.ps1 \| iex$/m;

const shSrc = readFileSync(join(tree, "install.sh"), "utf8");
let sh = pin(shSrc, RE_URL, `GOV_INSTALL_URL="\${GOV_INSTALL_URL:-http://${SELF}/install.sh}"`, "GOV_INSTALL_URL");
sh = pin(sh, RE_PKG, `GOV_PKG="\${GOV_PKG:-http://${SELF}/gov.tgz}"`, "GOV_PKG");
const RE_PS1_PKG = /^\$GovPkgDefault\s*=\s*'[^']*'$/m;
let ps1 = pin(readFileSync(join(tree, "install.ps1"), "utf8"), RE_PS1_SELF, `#   irm http://${SELF}/install.ps1 | iex`, "the install.ps1 self-reference");
// The Windows installer installs YOUR client too — the same served tarball. No registry: it is a URL.
ps1 = pin(ps1, RE_PS1_PKG, `$GovPkgDefault      = 'http://${SELF}/gov.tgz'`, "install.ps1 $GovPkgDefault");

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
wrote = true;

writeFileSync(join(OUT, "install.sh"), sh);
writeFileSync(join(OUT, "install.ps1"), ps1);
copyFileSync(tgz, join(OUT, "gov.tgz"));

// The page. The template says https://{{HOST}}; local is plain http, so the scheme is rewritten BEFORE the host
// is filled in — the template and build.mjs stay exactly as the shared envs need them.
// WHERE THE COMMANDS RUN (PRJ-121, 2026-09-22). Every command on this page names host.docker.internal, because
// that is how a walker CONTAINER reaches this machine. Asked on the walk: does that load in the browser? Only
// where the OS resolves it (Docker Desktop adds it). The banner says so, and gives the address that always works.
const banner = `<div class="envbar">LOCAL — your working tree, built on this machine. Never deployed anywhere.<br>` +
  `The commands below are for a walker <strong>container</strong> (host.docker.internal is how it reaches this machine). ` +
  `In this machine's browser, use <a href="http://localhost:${PORT}/">http://localhost:${PORT}</a>. ` +
  `On native Linux Docker, start the container with <code>--add-host=host.docker.internal:host-gateway</code>.</div>`;
const html = readFileSync(join(HERE, "template", "index.html"), "utf8")
  .replaceAll("https://{{HOST}}", "http://{{HOST}}")
  .replaceAll("{{HOST}}", SELF)
  .replaceAll("{{REF}}", "your working tree")
  .replaceAll("{{PKG}}", `your local client (http://${SELF}/gov.tgz)`)
  .replaceAll("{{REPO}}", "https://github.com/svayam-opensource/governed-agentic-dev-framework")
  .replaceAll("{{ROBOTS}}", "noindex, nofollow")
  .replaceAll("{{BUILT}}", new Date().toISOString().slice(0, 10))
  .replaceAll("{{ENV_BANNER}}", banner)
  .replaceAll("{{VERSIONED}}", "");
writeFileSync(join(OUT, "index.html"), html);
copyFileSync(join(HERE, "template", "style.css"), join(OUT, "style.css"));
// Several names, space-separated: caddyfile.mjs writes `@local host <this>`, and Caddy's host matcher takes a list.
writeFileSync(join(OUT, "CNAME"), LOCAL_HOSTS.join(" ") + "\n");
writeFileSync(join(OUT, "robots.txt"), "User-agent: *\nDisallow: /\n");

console.log(`built local → site/dist/local`);
console.log(`  hosts ${LOCAL_HOSTS.join(", ")} · install.sh from ${tree} · client ${tgz.split("/").pop()} → /gov.tgz`);

if (verify) {
  const fail = [];
  const served = readFileSync(join(OUT, "install.sh"), "utf8");
  if (!served.startsWith("#!")) fail.push("install.sh does not begin with a shebang");

  // EXACTLY two lines differ from the worktree's installer, and both are pins. Anything else means this script
  // changed something it had no business changing.
  const a = served.split("\n"), b = shSrc.split("\n");
  if (a.length !== b.length) fail.push(`served install.sh has ${a.length} lines, the worktree's has ${b.length}`);
  else {
    const diff = a.map((l, i) => (l === b[i] ? null : i)).filter((i) => i !== null);
    if (diff.length !== 2 || !diff.every((i) => RE_URL.test(a[i]) || RE_PKG.test(a[i]))) {
      fail.push(`served install.sh differs from the worktree's on ${diff.length} line(s) (${diff.map((i) => i + 1).join(", ")}); exactly the 2 pins are expected`);
    }
  }
  if (!served.includes(`GOV_PKG="\${GOV_PKG:-http://${SELF}/gov.tgz}"`)) fail.push("GOV_PKG does not point at the served client");
  // No registry: GOV_PKG is a URL. A pinned registry here would be meaningless at best.
  if (/^GOV_REGISTRY="\$\{GOV_REGISTRY:-.+\}"$/m.test(served)) fail.push("a local install.sh must not pin a registry");
  const servedPs1 = readFileSync(join(OUT, "install.ps1"), "utf8");
  if (!servedPs1.includes(`$GovPkgDefault      = 'http://${SELF}/gov.tgz'`)) fail.push("install.ps1 does not install the served client");
  if (/^\$GovRegistryDefault\s*=\s*'[^']+'$/m.test(servedPs1)) fail.push("a local install.ps1 must not pin a registry");

  // The tarball must be the gov client, not merely a file that exists.
  const head = readFileSync(join(OUT, "gov.tgz")).subarray(0, 2);
  if (head[0] !== 0x1f || head[1] !== 0x8b) fail.push("gov.tgz is not gzip");
  else {
    const pj = spawnSync("tar", ["-xzOf", join(OUT, "gov.tgz"), "package/package.json"], { encoding: "utf8" });
    let name = "";
    try { name = JSON.parse(pj.stdout).name; } catch { /* reported below */ }
    if (name !== "@svayam-opensource/gov") fail.push(`gov.tgz holds '${name || "nothing readable"}', not @svayam-opensource/gov`);
  }

  const page = readFileSync(join(OUT, "index.html"), "utf8");
  if (page.includes("{{")) fail.push("index.html has an unsubstituted {{TOKEN}}");
  if (!page.includes("LOCAL — your working tree")) fail.push("the local page is missing its LOCAL banner");
  if (!page.includes(`http://localhost:${PORT}`)) fail.push("the local page does not say which address works in this machine's browser");
  if (page.includes("https://" + SELF)) fail.push("the local page still says https — nothing local serves TLS");
  const primary = page.match(/<code id="cmd-unix">([^<]*)<\/code>/)?.[1] ?? "";
  if (!primary.includes("-o install.sh")) fail.push("the primary install command does not fetch to a file first");
  if (/\|\s*(GOV_YES=1\s+)?bash/.test(primary)) fail.push("the primary install command pipes curl into bash, which hides a failed download");
  if (readFileSync(join(OUT, "CNAME"), "utf8").trim() !== LOCAL_HOSTS.join(" ")) fail.push("CNAME does not name the local hosts");
  for (const f of ["index.html", "style.css", "install.sh", "install.ps1", "gov.tgz", "CNAME", "robots.txt"]) {
    if (!existsSync(join(OUT, f))) fail.push(`missing ${f}`);
  }
  if (fail.length) die(`verify:\n  ✗ ${fail.join("\n  ✗ ")}`);
  console.log(`  verify: served install.sh IS the worktree's, differing only in 2 pins (GOV_INSTALL_URL, GOV_PKG) · gov.tgz is the gov client`);
}

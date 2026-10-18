#!/usr/bin/env node
// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * The Caddyfile the gov-install container serves with — generated from the build's own output.
 *
 *   node site/caddyfile.mjs site/dist [port]   → stdout
 *
 * ONE IMAGE, EVERY ENVIRONMENT. gov builds a container once at dev and promotes the same image to uat and
 * prod, so the image carries all three builds and picks one per request by HOST: the Caddy edge passes the
 * requested name through, and gov.svayamtech.com is only ever routed to the prod container. The host names are
 * read from each build's CNAME — written by build.mjs from the same derivation it prints on the page — so
 * this file never holds a second copy of the DN rule.
 *
 * WHAT MUST NEVER HAPPEN: a missing path answered with a page. The adopter pipes /install.sh into a shell
 * (or saves it and runs it), so there is no try_files and no fallback — a missing file is a 404. And the two
 * scripts are served as text/plain: `irm … | iex` needs a string, and an unknown type arrives as bytes.
 *
 * SCRIPTS ONLY; THE PAGE IS THE PORTAL'S (PRJ-121 intent 02 addendum, IS-E2, rulings A5 + A14, 2026-10-18).
 * `/` and the old page path `/index.html` answer 302 to that env's portal `/install`, read from the build's
 * PORTAL file (build.mjs derives it by the DN rule, slug `portal`). Those two paths and no others: a redirect on a
 * script path is a shell handed HTML. A 302, not a 301, because the page moves again when the gov app gets its own
 * DN (A14) and a browser keeps a 301 forever. `versions.json` is JSON, readable cross-origin by that env's portal
 * ONLY — the page reads it, so the page and the scripts can never disagree.
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { ORIGIN, PORTAL_PATH } from "./lib.mjs";

export const PORT = 4002;

/** @param {{ env: string, host: string, portal: string }[]} sites  @param {number} [port] */
export function renderCaddyfile(sites, port = PORT) {
  if (!sites.length) throw new Error("no site builds to serve — run build.mjs for at least one env first");
  for (const { env, portal } of sites) {
    if (!ORIGIN.test(portal ?? "")) throw new Error(`${env}: no portal origin to redirect / to (got '${portal}')`);
  }
  const blocks = sites.map(({ env, host, portal }) => [
    `\t@${env} host ${host}`,
    `\thandle @${env} {`,
    `\t\t@page path / /index.html`,
    `\t\tredir @page ${portal}${PORTAL_PATH} 302`,
    `\t\troot * /srv/${env}`,
    `\t\t@versions path /versions.json`,
    `\t\theader @versions Content-Type "application/json; charset=utf-8"`,
    `\t\theader @versions Access-Control-Allow-Origin "${portal}"`,
    `\t\t@scripts path *.sh *.ps1`,
    `\t\theader @scripts Content-Type "text/plain; charset=utf-8"`,
    // The Windows installers winget fetches, once this host carries them: public, no redirect, and typed —
    // Caddy knows no type for .msi and would send none.
    `\t\t@msi path *.msi`,
    `\t\theader @msi Content-Type "application/x-msi"`,
    `\t\tfile_server`,
    `\t}`,
  ].join("\n"));
  return [
    "{",
    "\tadmin off",
    "\tauto_https off",
    "}",
    "",
    `:${port} {`,
    "\t@healthz path /healthz",
    "\thandle @healthz {",
    '\t\trespond "ok" 200',
    "\t}",
    ...blocks,
    "\thandle {",
    '\t\trespond "not found" 404',
    "\t}",
    "}",
    "",
  ].join("\n");
}

/**
 * Every env build under `dist` that wrote a CNAME, sorted by env name, with the portal its `/` redirects to.
 * A build with no PORTAL is refused: a redirect target is derived once, in build.mjs, never guessed here.
 */
export function sitesIn(dist) {
  return readdirSync(dist, { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(join(dist, d.name, "CNAME")))
    .map((d) => {
      const f = join(dist, d.name, "PORTAL");
      if (!existsSync(f)) throw new Error(`${d.name}: the build wrote no PORTAL — rebuild it; / must redirect to its portal`);
      const portal = readFileSync(f, "utf8").trim();
      if (!ORIGIN.test(portal)) throw new Error(`${d.name}: PORTAL '${portal}' is not an origin (https://host[:port])`);
      return { env: d.name, host: readFileSync(join(dist, d.name, "CNAME"), "utf8").trim(), portal };
    })
    .sort((a, b) => a.env.localeCompare(b.env));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const dist = process.argv[2];
  if (!dist) { console.error("usage: node site/caddyfile.mjs <dist-dir> [port]"); process.exit(2); }
  process.stdout.write(renderCaddyfile(sitesIn(dist), process.argv[3] ? Number(process.argv[3]) : PORT));
}

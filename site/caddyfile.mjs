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
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export const PORT = 4002;

/** @param {{ env: string, host: string }[]} sites  @param {number} [port] */
export function renderCaddyfile(sites, port = PORT) {
  if (!sites.length) throw new Error("no site builds to serve — run build.mjs for at least one env first");
  const blocks = sites.map(({ env, host }) => [
    `\t@${env} host ${host}`,
    `\thandle @${env} {`,
    `\t\troot * /srv/${env}`,
    `\t\t@scripts path *.sh *.ps1`,
    `\t\theader @scripts Content-Type "text/plain; charset=utf-8"`,
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

/** Every env build under `dist` that wrote a CNAME, sorted by env name. */
export function sitesIn(dist) {
  return readdirSync(dist, { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(join(dist, d.name, "CNAME")))
    .map((d) => ({ env: d.name, host: readFileSync(join(dist, d.name, "CNAME"), "utf8").trim() }))
    .sort((a, b) => a.env.localeCompare(b.env));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const dist = process.argv[2];
  if (!dist) { console.error("usage: node site/caddyfile.mjs <dist-dir> [port]"); process.exit(2); }
  process.stdout.write(renderCaddyfile(sitesIn(dist), process.argv[3] ? Number(process.argv[3]) : PORT));
}

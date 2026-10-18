#!/usr/bin/env node
// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * DOES THE DOOR OPEN? (#181, plan 04 T07, ruling Q2 A)
 *
 * The first link an adopter follows is the door URL. If it does not answer, the walk fails before it
 * starts — gov.svayam.ai did exactly that. This asks the network, so it is NOT part of `npm test`
 * (a DNS hiccup must never turn a pull request red); CI runs it on a schedule (catalog-freshness.yml).
 *
 * Checks: every distinct door-host URL named in the people-facing docs, plus the door itself and the
 * two installers it serves, each answering HTTP 200. Exit 1 if any does not.
 *
 * A SCRIPT NEVER REDIRECTS (PRJ-121 IS-E2, spec IS-A17). The door's `/` answers 302 to the portal's /install,
 * so a page URL is followed to its end. A script URL (.sh, .ps1, .msi) and versions.json must answer 200
 * THEMSELVES: a redirect there is how a shell gets handed HTML, so a 3xx is a failure, not a hop.
 *
 *   npm run door:check
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { DOOR_URL, peopleFacingDocs } from "./door-docs.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
const host = new URL(DOOR_URL).host;
const urls = new Set([`${DOOR_URL}/`, `${DOOR_URL}/install.sh`, `${DOOR_URL}/install.ps1`]);
const re = new RegExp(`https://${host.replace(/\./g, "\\.")}[^\\s)"'<>\`]*`, "g");
for (const f of peopleFacingDocs(ROOT)) {
  for (const m of fs.readFileSync(path.join(ROOT, f), "utf8").matchAll(re)) {
    const u = m[0].replace(/[.,;:]+$/, "");
    if (!u.includes("{{")) urls.add(u === DOOR_URL ? `${DOOR_URL}/` : u);
  }
}

/** A file a shell or winget fetches, or the page's data — never allowed to redirect. */
const NEVER_REDIRECTS = /\.(sh|ps1|msi)$|\/versions\.json$/;

let bad = 0;
for (const u of [...urls].sort()) {
  let status;
  try {
    const redirect = NEVER_REDIRECTS.test(new URL(u).pathname) ? "manual" : "follow";
    const r = await fetch(u, { method: "GET", redirect, signal: AbortSignal.timeout(20_000) });
    status = r.status >= 300 && r.status < 400 ? `${r.status} redirect — a script must never redirect` : r.status;
  } catch (e) {
    status = `unreachable (${e?.cause?.code ?? e?.name ?? "error"})`;
  }
  const ok = status === 200;
  if (!ok) bad++;
  console.log(`${ok ? "✓" : "✗"} ${u} → ${status}`);
}
if (bad) {
  console.error(`\n${bad} door link(s) do not answer 200. The door is ${DOOR_URL} (ruling Q2 A); DNS and hosting are a Policy Owner item (P2).`);
  process.exit(1);
}

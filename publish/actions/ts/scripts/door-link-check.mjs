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

let bad = 0;
for (const u of [...urls].sort()) {
  let status;
  try {
    const r = await fetch(u, { method: "GET", redirect: "follow", signal: AbortSignal.timeout(20_000) });
    status = r.status;
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

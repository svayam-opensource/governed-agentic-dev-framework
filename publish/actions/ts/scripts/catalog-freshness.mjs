#!/usr/bin/env node
// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * Has a vendor shipped a CLI since we last looked?
 *
 * WHY THIS EXISTS. `test/cli/agent-matrix.test.ts` asserts what the catalog CLAIMS, which makes
 * it excellent at stopping a change and useless at noticing the world moved. Two entries said
 * "there is no Cline CLI" and treated Continue as extension-only; both vendors had shipped npm
 * CLIs, and the matrix would have frozen those sentences indefinitely — a test that pins a
 * claim cannot tell you the claim expired.
 *
 * So this asks npm instead of asking ourselves. It is NETWORK-DEPENDENT and therefore not a
 * unit test: it belongs on a schedule, where a flake costs a re-run rather than a red PR.
 *
 * PROVENANCE IS THE POINT, NOT EXISTENCE. `windsurf` exists on npm — v0.0.1, "Coming soon.",
 * maintained by colin@edgedb.com — and installing it would be #201 all over again. So a hit
 * only counts when a maintainer's email domain or the repository owner matches the vendor we
 * expect. A name that merely looks right is reported as a NEAR MISS, never as a finding.
 *
 *   node scripts/catalog-freshness.mjs            report, exit 1 on a new vendor CLI
 *   node scripts/catalog-freshness.mjs --quiet    exit code only
 */
import { AGENT_CATALOG } from "../lib/esm/cli/agent-catalog.js";

/**
 * What to look for, per agent that gov cannot currently install from a package manager.
 *
 * Hand-written on purpose: guessing package names from an id is how you end up installing
 * someone else's `windsurf`. `vendor` is matched against maintainer email domains and the
 * repository owner — both things only the vendor controls.
 */
const WATCH = {
  windsurf: {
    candidates: ["windsurf", "@windsurf/cli", "@codeium/windsurf"],
    vendor: ["windsurf.com", "codeium.com", "cognition.ai", "windsurf", "codeium"],
  },
  aider: {
    candidates: ["aider", "aider-chat", "@aider/cli"],
    vendor: ["aider.chat", "aider-ai", "paul-gauthier"],
  },
};

const quiet = process.argv.includes("--quiet");
const say = (s) => { if (!quiet) process.stdout.write(`${s}\n`); };

async function packument(name) {
  const res = await fetch(`https://registry.npmjs.org/${name.replace("/", "%2F")}`, {
    headers: { accept: "application/json" },
  });
  if (!res.ok) return null;
  return res.json();
}

/** Does this package plausibly belong to the vendor? Maintainer domains and repo owner only. */
function provenance(pack, vendor) {
  const latest = pack["dist-tags"]?.latest;
  const manifest = latest ? pack.versions?.[latest] ?? {} : {};
  const emails = (pack.maintainers ?? []).map((m) => String(m.email ?? m)).join(" ").toLowerCase();
  const repo = String(manifest.repository?.url ?? pack.repository?.url ?? "").toLowerCase();
  const hit = vendor.find((v) => emails.includes(v.toLowerCase()) || repo.includes(v.toLowerCase()));
  return { version: latest, emails, repo, vendorMatch: hit ?? null };
}

let findings = 0;
let nearMisses = 0;

say("catalog freshness — agents gov cannot install from a package manager\n");
for (const [id, { candidates, vendor }] of Object.entries(WATCH)) {
  const entry = AGENT_CATALOG.find((a) => a.id === id);
  if (!entry) { say(`  ${id}: not in the catalog any more — drop it from WATCH`); continue; }
  if (entry.install?.npm || entry.install?.script || entry.install?.brew) {
    say(`  ${id}: already installable — drop it from WATCH`);
    continue;
  }

  for (const name of candidates) {
    const pack = await packument(name).catch(() => null);
    if (!pack) { say(`  ${id.padEnd(10)} ${name.padEnd(22)} not on npm`); continue; }
    const p = provenance(pack, vendor);
    if (p.vendorMatch) {
      findings++;
      say(`  ${id.padEnd(10)} ${name.padEnd(22)} FOUND v${p.version} — vendor match on '${p.vendorMatch}'`);
      say(`             repo ${p.repo || "—"}`);
      say(`             → the catalog says gov cannot install ${id}. Verify the BINARY name`);
      say(`               (npm view ${name} bin), then add install.npm plus a VENDOR_SCOPES or`);
      say(`               UNSCOPED_VERIFIED entry in test/cli/agent-catalog.test.ts.`);
    } else {
      nearMisses++;
      say(`  ${id.padEnd(10)} ${name.padEnd(22)} exists v${p.version} but NOT the vendor's — near miss`);
      say(`             maintainers ${p.emails || "—"}`);
    }
  }
}

say("");
say(`${findings} vendor CLI(s) available that the catalog calls unavailable; ${nearMisses} near miss(es) ignored.`);
if (findings > 0) {
  say("");
  say("Not a build failure. A prompt to look: a vendor shipped something, and the catalog is");
  say("stale in the direction that costs adopters an agent they could already be using.");
}
process.exit(findings > 0 ? 1 : 0);

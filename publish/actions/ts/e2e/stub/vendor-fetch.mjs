// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
//
// THE VENDOR DOWNLOAD, DOUBLED — loaded into gov with `node --import`: by the journey's `gov` wrapper, and in the
// OS tier (os.d/96) through NODE_OPTIONS, since there `gov` is install.sh's real wrapper.
//
// gov used to run `sh -c "curl … | bash"`, so a scenario doubled the vendor's installer by putting a `curl`
// on PATH. Since #205 (Q16 C) gov downloads the script ITSELF (one https GET in Node), checks it against the
// catalog's pinned sha256, and runs those exact bytes with `bash -s`. A PATH `curl` no longer sits on that
// path, so the journeys reached the real bob.ibm.com, got the real installer, and failed inside it.
//
// The seam moves with the code; the scenarios' `curl` doubles stay what they were:
//   · the scenario's `curl` double (named by GOV_E2E_VENDOR_CURL) is still the one place that says what a vendor
//     URL serves;
//   · `fetch` is answered from it, and anything it does not serve FAILS — nothing leaves the world;
//   · a PINNED entry (none today — D1 unpinned Bob) is re-pinned to the double's bytes, so what would run is gov's
//     real "pinned and matches" path. Unpinned scripts are shown and ASKED about; the journeys answer `y`.
//     Drift refusal is proven in test/cli/agent-script-pin.test.ts, not here.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, realpathSync } from "node:fs";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

const curl = process.env.GOV_E2E_VENDOR_CURL ?? "";
const served = new Map();

function serve(url) {
  if (served.has(url)) return served.get(url);
  let bytes = null;
  if (curl && existsSync(curl)) {
    try { bytes = new Uint8Array(execFileSync(curl, ["-fsSL", url], { stdio: ["ignore", "pipe", "ignore"] })); }
    catch { bytes = null; }
  }
  served.set(url, bytes);
  return bytes;
}

if (curl) {
  // THE RUNNING gov's catalog — the same module instance bin.js imports — wherever that gov is installed.
  // Under NODE_OPTIONS every node process loads this file, not only gov: one with no catalog beside it is left alone.
  let AGENT_CATALOG = [];
  try {
    const bin = realpathSync(process.argv[1] ?? "");
    ({ AGENT_CATALOG } = await import(pathToFileURL(join(dirname(bin), "agent-catalog.js")).href));
  } catch { /* not gov */ }
  const installs = [];
  for (const a of AGENT_CATALOG) {
    if (a.install) installs.push(a.install);
    for (const v of a.variants ?? []) if (v.install) installs.push(v.install);
  }
  for (const inst of installs) {
    if (!inst.script || !inst.scriptSha256) continue;
    const bytes = serve(inst.script);
    if (bytes) inst.scriptSha256 = createHash("sha256").update(bytes).digest("hex");
  }

  globalThis.fetch = async (input) => {
    const url = typeof input === "string" ? input : input.url ?? String(input);
    const bytes = serve(url);
    if (!bytes) throw new Error(`no network in the journey world (${url} is not doubled)`);
    return new Response(bytes, { status: 200 });
  };
}

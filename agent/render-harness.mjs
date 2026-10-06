#!/usr/bin/env node
// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * render-harness — regenerate the per-tool agent harness files.
 *
 * NOW A THIN WRAPPER, and that is the point (PRJ-121, 2026-09-28). The rendering itself moved into the gov CLI
 * (`publish/actions/ts/src/rules/harness-render.ts`) because this script lives in the PUBLISHER'S repository and
 * an adopter never receives it. The framework's own cues could therefore become resident agent instructions and
 * an organization's could not — "write a policy and your agents will follow it" was true for us and false for
 * every customer.
 *
 * Two implementations of "assemble the resident block" would be worse than none: the publisher's output and the
 * adopter's would drift, and the difference would show up as an agent obeying rules nobody could reproduce. So
 * this file now calls exactly the code an adopter runs, and keeps only what belongs to the publisher: where the
 * files go in THIS repository, and the manifest listing for `--list`.
 *
 * Usage:
 *   node agent/render-harness.mjs            render every generated harness file
 *   node agent/render-harness.mjs --check    exit 1 if any generated file is stale
 *   node agent/render-harness.mjs --list     list every harness + its tier/path
 *
 * It writes the nine files AND `agent/harness/rule-map.md`, so `--check` covers both (P3 cutover, 2026-10-06).
 *
 * `--project <PID>` is gone: per-project entrypoints are `gov work`'s business (it mirrors the harness into the
 * project directory on every launch), and the flag rendered files nothing read.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { load as yamlLoad } from "js-yaml";
import { HARNESS_TARGETS } from "../publish/actions/ts/src/rules/harness-render.ts";
import { buildArtifacts } from "../publish/actions/ts/src/rules/rules-build.ts";
import { loadRuleStoresFrom, isStoreError, isStoreWarning } from "../publish/actions/ts/src/rules/model/store-io.ts";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..");
const MANIFEST = join(REPO, "agent/harness-manifest.yaml");
const PROTOCOL = join(REPO, "agent/session-protocol.md");
const CONTENT = join(REPO, "publish", "content");
/**
 * The org scope the publisher's tree is read under. Its org-config is a template (empty slug), and the seeded
 * `policies/rules.yaml` is empty, so the scope only has to be a valid one. An adopter's build reads its own slug.
 */
const TEMPLATE_SCOPE = "ORG";

let mode = "render";
for (const a of process.argv.slice(2)) {
  if (a === "--check") mode = "check";
  else if (a === "--list") mode = "list";
  else if (a === "-h" || a === "--help") {
    process.stdout.write("Usage: node agent/render-harness.mjs [--check|--list]\n");
    process.exit(0);
  } else {
    process.stderr.write(`ERROR: unknown argument: ${a}\n`);
    process.exit(1);
  }
}

if (mode === "list") {
  const M = yamlLoad(readFileSync(MANIFEST, "utf8")) || {};
  const pad = (s, n) => String(s ?? "?").slice(0, n).padEnd(n);
  process.stdout.write(`${pad("id", 18)} ${pad("tool", 22)} ${pad("tier", 15)} ${pad("status", 9)} path\n${"-".repeat(90)}\n`);
  for (const h of M.harnesses ?? []) {
    process.stdout.write(`${pad(h.id, 18)} ${pad(h.tool || "", 22)} ${pad(h.tier, 15)} ${pad(h.status, 9)} ${h.path || "(none)"}\n`);
  }
  process.stdout.write(`\nRendered by gov: ${HARNESS_TARGETS.map((t) => t.path).join(", ")}\n`);
  process.exit(0);
}

// THE SAME LOADER AND THE SAME BUILD `gov rules build` RUNS (P3 cutover, 2026-10-06): the rule stores under
// publish/content/ — framework/rules/ and the seeded policies/ — into the nine files and agent/harness/rule-map.md.
const loaded = loadRuleStoresFrom({
  where: "publish/content",
  orgScope: TEMPLATE_SCOPE,
  read: (rel) => (existsSync(join(CONTENT, rel)) ? readFileSync(join(CONTENT, rel), "utf8") : undefined),
});
if (!loaded.ok) {
  process.stderr.write(`ERROR: ${loaded.reason}\n`);
  process.exit(1);
}
for (const d of loaded.diagnostics.filter(isStoreWarning)) process.stderr.write(`WARNING: ${d.store} ${d.id} ${d.kind} — ${d.message}\n`);
const errors = loaded.diagnostics.filter(isStoreError);
if (errors.length) {
  for (const d of errors) process.stderr.write(`ERROR: ${d.store} ${d.id} ${d.kind} — ${d.message}\n`);
  process.exit(1);
}
const rendered = buildArtifacts(readFileSync(PROTOCOL, "utf8"), loaded.set);
if ("error" in rendered) {
  process.stderr.write(`ERROR: ${rendered.error}\n`);
  process.exit(1);
}

if (mode === "check") {
  const drift = rendered.files.filter((f) => {
    const path = join(CONTENT, f.path);
    return (existsSync(path) ? readFileSync(path, "utf8") : null) !== f.content;
  });
  if (drift.length) {
    process.stdout.write("DRIFT — these generated files are out of sync with the protocol and the rule stores:\n");
    for (const d of drift) process.stdout.write(`  - ${d.path}\n`);
    process.stdout.write("\nRun: node agent/render-harness.mjs\n");
    process.exit(1);
  }
  process.stdout.write(`OK — all ${rendered.files.length} generated harness files are in sync.\n`);
  process.exit(0);
}

for (const f of rendered.files) {
  const path = join(CONTENT, f.path);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, f.content);
  process.stdout.write(`rendered: ${f.path}\n`);
}
process.stdout.write(
  `\n${rendered.files.length} files rendered from agent/session-protocol.md + the rule stores' resident cues,\n`
  + "through the same code an adopter's `gov rules build` runs.\n",
);

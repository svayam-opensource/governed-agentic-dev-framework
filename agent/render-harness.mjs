#!/usr/bin/env node
// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * render-harness — regenerate the per-tool agent harness files from the canonical
 * protocol. Node port of the legacy render-harness.sh (bash + python/yaml).
 *
 * Source of truth: agent/session-protocol.md + agent/harness-manifest.yaml.
 * Generated install paths (manifest harnesses[].path, generated: true) are
 * overwritten — never hand-edit them; edit the protocol, then re-render.
 *
 * Usage:
 *   node agent/render-harness.mjs            render all generated harness files
 *   node agent/render-harness.mjs --check    exit 1 if any generated file is stale
 *   node agent/render-harness.mjs --list     list every harness + its tier/path
 *   node agent/render-harness.mjs --project <PID>   per-project entrypoints
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { load as yamlLoad } from "js-yaml";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..");
const MANIFEST = join(REPO, "agent/harness-manifest.yaml");
const PROTOCOL = join(REPO, "agent/session-protocol.md");

for (const f of [MANIFEST, PROTOCOL]) {
  if (!existsSync(f)) {
    process.stderr.write(`ERROR: not found: ${relative(REPO, f)}\n`);
    process.exit(1);
  }
}

// ── args ──────────────────────────────────────────────────────────────────
let mode = "render";
let pid = "";
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  if (a === "--check") mode = "check";
  else if (a === "--list") mode = "list";
  else if (a === "--project") {
    mode = "project";
    pid = process.argv[++i] ?? "";
    if (!pid) { process.stderr.write("ERROR: --project needs a <PID>\n"); process.exit(1); }
  } else if (a === "-h" || a === "--help") {
    process.stdout.write("Usage: node agent/render-harness.mjs [--check|--list|--project <PID>]\n");
    process.exit(0);
  } else { process.stderr.write(`ERROR: unknown argument: ${a}\n`); process.exit(1); }
}

const M = yamlLoad(readFileSync(MANIFEST, "utf8")) || {};
const banner = (M.generated_banner || "").trim();
const templates = M.templates || {};
const harnesses = M.harnesses || [];
// THE C01 DIGEST IS INLINED, NOT REFERENCED (Policy Owner, 2026-09-11).
//
// A reference is only as strong as the agent's willingness to open a second file, and gov
// cannot verify that it did — so "the governance requirements are in the agent's context"
// would have degraded to "are reachable from it". Inlining at RENDER time keeps the single
// source of truth in the policy (no second copy to drift, the copies carry a do-not-edit
// banner) while putting the rules where the agent already is.
//
// A missing or unmarked digest is FATAL. Rendering a protocol whose Part A is empty would
// produce a file that looks governed and governs nothing — and gov now refuses to launch on
// a bad protocol file, so a silent hole here becomes a blocked adoption later, far from here.
const POLICY = join(REPO, "publish", "content", "knowledge", "policies", "org-ai-agent-governance-policy.md");
function alwaysRules() {
  if (!existsSync(POLICY)) {
    process.stderr.write(`ERROR: ${POLICY} is missing — Part A of the protocol cannot be built\n`);
    process.exit(1);
  }
  const text = readFileSync(POLICY, "utf8");
  const m = /<!--\s*C01-DIGEST:start\s*-->\n([\s\S]*?)\n<!--\s*C01-DIGEST:end\s*-->/.exec(text);
  if (!m || !m[1].trim()) {
    process.stderr.write("ERROR: no C01-DIGEST block in the policy — Part A would render empty\n");
    process.exit(1);
  }
  return m[1].replace(/\n+$/, "");
}

// THE MARKER IS WHAT MAKES THE FILE VERIFIABLE, so its absence is fatal here rather than
// discovered at launch. `verifyAgentContext` refuses to start an agent whose instructions file
// carries no `gov-protocol-version` line — that is how gov tells its own protocol apart from an
// adopter's hand-written CLAUDE.md, and it is the only discriminator it has. Render a protocol
// without the marker and every agent becomes unlaunchable, in a way whose cause is nowhere near
// the effect. One `grep` here costs nothing and keeps the two ends honest.
const PROTOCOL_MARKER = "gov-protocol-version";
const body = (() => {
  const raw = readFileSync(PROTOCOL, "utf8");
  if (!raw.includes(PROTOCOL_MARKER)) {
    process.stderr.write(`ERROR: ${PROTOCOL} carries no '${PROTOCOL_MARKER}' line.\n`);
    process.stderr.write("       gov verifies that marker before launching any agent; without it every\n");
    process.stderr.write("       rendered harness file would be rejected as 'not the protocol gov renders'.\n");
    process.exit(1);
  }
  return raw.replace(/\n+$/, "").replaceAll("{{render.always_rules}}", alwaysRules());
})();

const replaceAll = (s, from, to) => s.split(from).join(to);

function subst(tmpl, mapping, extra) {
  let out = tmpl;
  for (const [k, v] of Object.entries(mapping)) out = replaceAll(out, `{{render.${k}}}`, v);
  for (const [k, v] of Object.entries(extra || {})) {
    const sv = v === true ? "true" : v === false ? "false" : String(v);
    out = replaceAll(out, `{{template_extra.${k}}}`, sv);
  }
  return out.replace(/\n+$/, "") + "\n";
}

function renderFile(h, bodyText) {
  const t = h.template;
  if (!t || !(t in templates)) {
    process.stderr.write(`ERROR: harness '${h.id}' references unknown template '${t}'\n`);
    process.exit(1);
  }
  return subst(templates[t], { generated_banner: banner, body: bodyText }, h.template_extra);
}

const generatedActive = () => harnesses.filter((h) => h.generated && h.status === "active");

function write(path, content) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

// ── list ──────────────────────────────────────────────────────────────────
if (mode === "list") {
  const pad = (s, n) => String(s ?? "?").slice(0, n).padEnd(n);
  process.stdout.write(`${pad("id", 18)} ${pad("tool", 22)} ${pad("tier", 15)} ${pad("status", 9)} ${pad("gen", 7)} path\n`);
  process.stdout.write(`${"-".repeat(100)}\n`);
  for (const h of harnesses) {
    process.stdout.write(`${pad(h.id, 18)} ${pad(h.tool || "", 22)} ${pad(h.tier, 15)} ${pad(h.status, 9)} ${pad(String(!!h.generated), 7)} ${h.path || "(none)"}\n`);
  }
  process.stdout.write(`\nGenerated on \`render\`: ${generatedActive().map((h) => h.id).join(", ")}\n`);
  process.exit(0);
}

// ── render / check ──────────────────────────────────────────────────────────
if (mode === "render" || mode === "check") {
  const drift = [];
  const wrote = [];
  for (const h of generatedActive()) {
    const path = join(REPO, h.path);
    const content = renderFile(h, body);
    if (mode === "check") {
      const existing = existsSync(path) ? readFileSync(path, "utf8") : null;
      if (existing !== content) drift.push(h.path);
    } else {
      write(path, content);
      wrote.push(h.path);
    }
  }
  if (mode === "check") {
    if (drift.length) {
      process.stdout.write("DRIFT — these generated files are out of sync with agent/session-protocol.md:\n");
      for (const d of drift) process.stdout.write(`  - ${d}\n`);
      process.stdout.write("\nRun: node agent/render-harness.mjs\n");
      process.exit(1);
    }
    process.stdout.write(`OK — all ${generatedActive().length} generated harness files are in sync.\n`);
    process.exit(0);
  }
  for (const w of wrote) process.stdout.write(`rendered: ${w}\n`);
  process.stdout.write(`\n${wrote.length} files rendered from agent/session-protocol.md.\n`);
  // The note that used to be here said "CLAUDE.md is import-tier (hand-maintained) — not
  // regenerated", two lines under a list that included `rendered: publish/content/CLAUDE.md`.
  // It was true until claude-code moved onto the shared template; a line that contradicts the
  // output above it teaches the reader to distrust both.
  process.stdout.write("Every agent receives the same rendered text — no per-vendor special case.\n");
  process.exit(0);
}

// ── project (per-project entrypoints under projects/<PID>/) ─────────────────
if (mode === "project") {
  const projDir = join(REPO, "projects", pid);
  if (!existsSync(projDir) || !statSync(projDir).isDirectory()) {
    process.stderr.write(`ERROR: project dir not found: projects/${pid} (seed it first)\n`);
    process.exit(1);
  }
  const ppAgent = join(projDir, "agent.md");
  const projCtx = existsSync(ppAgent) ? readFileSync(ppAgent, "utf8").replace(/\n+$/, "") : `See \`projects/${pid}/agent.md\` for project-specific context.`;
  const ppBody = `${body}\n\n---\n\n# Project entrypoint — ${pid}\n\n${projCtx}`;
  const wrote = [];
  for (const h of harnesses) {
    if (h.status !== "active") continue;
    if (h.tier === "import" && h.per_project_path) {
      const ppath = join(REPO, h.per_project_path.replaceAll("{project_id}", pid));
      write(ppath, `${(h.per_project_template || "").replace(/\n+$/, "")}\n`);
      wrote.push(relative(REPO, ppath));
      continue;
    }
    if (h.generated && h.path) {
      const ppath = join(projDir, h.path);
      write(ppath, renderFile(h, ppBody));
      wrote.push(relative(REPO, ppath));
    }
  }
  for (const w of wrote) process.stdout.write(`rendered: ${w}\n`);
  process.stdout.write(`\n${wrote.length} per-project entrypoints written under projects/${pid}/.\n`);
  process.exit(0);
}

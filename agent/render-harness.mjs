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
const body = readFileSync(PROTOCOL, "utf8").replace(/\n+$/, "");

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
  process.stdout.write("Note: CLAUDE.md is import-tier (hand-maintained) — not regenerated.\n");
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

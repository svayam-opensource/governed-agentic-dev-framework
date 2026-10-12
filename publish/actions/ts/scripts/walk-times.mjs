#!/usr/bin/env node
// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
//
// walk-times — cut a timed adopter walk into spec 04 §2.2's six steps, from gov's own run logs (PRJ-121 plan 04
// T17, #276).
//
// THE CLOCK (ruling Q3): README opened → the agent posts its context manifest. Account creation (GitHub, org,
// agent vendor) is excluded; every sign-in is included. The clock is CONTINUOUS: each step starts where the one
// before it ended, so the six durations always add up to the total and a hesitation is charged to the step it
// happened in front of.
//
//   step  ends at                                    from
//   1     install command running                   --install-at        (observer: gov is not here yet)
//   2     `gov` runs in this shell                  the first `run started`
//   3     checklist step 6 ticked                   `phase step-6-done` (else the last step marker, else `phase first-run`)
//   4     "what now exists" printed                 `phase adopt-done`
//   5     agent installed and runnable              `phase agent-ready`, else `chose agent` (an agent already installed)
//   6     agent posts its context manifest          --manifest-at (observer), else `phase agent-launch` (partial)
//   start README opened                             --start             (observer)
//
// Usage:
//   node scripts/walk-times.mjs [--os macos|linux|windows] [--start ISO] [--install-at ISO] [--manifest-at ISO]
//                               [--markdown | --json] <run log file or folder>...
// Folders are searched recursively for *.log — pass `~/.gov/logs/<day>` (runs before the GitHub login is known)
// and `<work-root>/preferences/<login>/state/logs/<day>` (runs after). Exit 0 when cut, 2 on a usage error.
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

export const STEPS = [
  "Door: README → one command",
  "Install: Node 24 + gov",
  "Dependencies + GitHub sign-in",
  "Adopt interview + repo created + seeded",
  "Agent install + sign-in",
  "First project: review offer → seed → launch",
];
/** Spec 04 §2.2, in seconds. macOS and Linux share a column. */
export const BUDGETS = {
  macos: [30, 90, 90, 150, 90, 90],
  linux: [30, 90, 90, 150, 90, 90],
  windows: [45, 60, 120, 150, 90, 90],
};
export const GATE_SECONDS = 600;

const LINE = /^(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z)\s+\w+\s+\S+\s+\S+\s+\d+\s+(.*)$/;

/** Every line of a run log, as { t: ms, msg } — the message without its `meta={…}` tail. */
export function parseLog(text) {
  const out = [];
  for (const raw of text.split("\n")) {
    const m = LINE.exec(raw);
    if (!m) continue;
    out.push({ t: Date.parse(m[1]), msg: m[2].replace(/ meta=.*$/, "").trim() });
  }
  return out;
}

/**
 * Every *.log under a path. A folder's project clones (`PRJ-*`), `.git` and `node_modules` are skipped: a whole
 * `~/.gov` holds governance-repo clones, and a clone's own files are not this machine's runs (found on the first
 * dry walk, where the stub template's test fixtures were read as the walk).
 */
function logFiles(p, top = true) {
  let st;
  try { st = fs.statSync(p); } catch { return []; }
  if (st.isFile()) return p.endsWith(".log") ? [p] : [];
  const name = path.basename(p);
  if (!top && (name === ".git" || name === "node_modules" || /^PRJ-/.test(name))) return [];
  return fs.readdirSync(p).flatMap((n) => logFiles(path.join(p, n), false));
}

const firstAfter = (events, after, test) => events.find((e) => (after === null || e.t >= after) && test(e.msg)) ?? null;
const phaseIs = (id) => (msg) => msg === `phase ${id}`;

/** The six steps, from parsed events (sorted by time) and the observer's marks (ms or null). */
export function cutSteps(events, { os = "linux", start = null, installAt = null, manifestAt = null } = {}) {
  const budgets = BUDGETS[os];
  if (!budgets) throw new Error(`unknown --os '${os}' (macos, linux, windows)`);
  const ev = [...events].sort((a, b) => a.t - b.t);
  const ends = [];
  const sources = [];

  ends[0] = installAt; sources[0] = installAt === null ? "not given (--install-at)" : "observer: install command";
  const gov = firstAfter(ev, null, (m) => m === "run started");
  ends[1] = gov?.t ?? null; sources[1] = gov ? "log: first `run started`" : "no gov run in the log";

  const firstRun = firstAfter(ev, ends[1], phaseIs("first-run"));
  const before = (e) => firstRun === null || e.t <= firstRun.t;
  const tick6 = ev.find((e) => e.msg === "phase step-6-done" && before(e));
  const lastStep = [...ev].reverse().find((e) => /^phase step-[\w]+(-done)?$/.test(e.msg) && before(e));
  const end3 = tick6 ?? lastStep ?? firstRun;
  ends[2] = end3?.t ?? null;
  sources[2] = tick6 ? "log: `phase step-6-done`" : lastStep ? `log: \`${lastStep.msg}\` (step 6 not ticked)` : firstRun ? "log: `phase first-run` (nothing to install)" : "no marker";

  const adopt = firstAfter(ev, ends[2], phaseIs("adopt-done"));
  ends[3] = adopt?.t ?? null; sources[3] = adopt ? "log: `phase adopt-done`" : "no marker";

  const ready = firstAfter(ev, ends[3], phaseIs("agent-ready")) ?? firstAfter(ev, ends[3], (m) => m === "chose agent");
  ends[4] = ready?.t ?? null; sources[4] = ready ? `log: \`${ready.msg}\`` : "no marker";

  if (manifestAt !== null) { ends[5] = manifestAt; sources[5] = "observer: context manifest posted"; }
  else {
    const launch = firstAfter(ev, ends[4], phaseIs("agent-launch")) ?? firstAfter(ev, ends[4], (m) => m === "launching the agent");
    ends[5] = launch?.t ?? null;
    sources[5] = launch ? "log: agent launch (manifest time not given — partial)" : "no marker";
  }

  const steps = STEPS.map((name, i) => {
    const s = i === 0 ? start : ends[i - 1];
    const e = ends[i];
    const seconds = s !== null && e !== null ? Math.round((e - s) / 1000) : null;
    return { n: i + 1, name, start: iso(s), end: iso(e), seconds, budget: budgets[i], over: seconds === null ? null : seconds > budgets[i], source: sources[i] };
  });
  const complete = start !== null && manifestAt !== null && steps.every((s) => s.seconds !== null);
  const totalFrom = start ?? ends[1];
  const totalSeconds = totalFrom !== null && ends[5] !== null ? Math.round((ends[5] - totalFrom) / 1000) : null;
  return { os, steps, start: iso(totalFrom), end: iso(ends[5]), totalSeconds, complete, withinGate: complete ? totalSeconds <= GATE_SECONDS : null };
}

const iso = (ms) => (ms === null ? null : new Date(ms).toISOString());
const clock = (isoStr) => (isoStr ? `${isoStr.slice(11, 19)}Z` : "—");
export const mmss = (s) => (s === null ? "—" : `${s < 0 ? "-" : ""}${Math.floor(Math.abs(s) / 60)}:${String(Math.abs(s) % 60).padStart(2, "0")}`);

/** The walk record's table (spec 04 §5). */
export function markdown(cut) {
  const rows = ["| step | start | end | duration | budget | over? |", "|---|---|---|---|---|---|"];
  for (const s of cut.steps) {
    rows.push(`| ${s.n} ${s.name} | ${clock(s.start)} | ${clock(s.end)} | ${mmss(s.seconds)} | ${mmss(s.budget)} | ${s.over === null ? "n/a" : s.over ? "**over**" : "under"} |`);
  }
  const verdict = cut.withinGate === null ? "n/a (partial)" : cut.withinGate ? "under" : "**over**";
  rows.push(`| **Total** | ${clock(cut.start)} | ${clock(cut.end)} | ${mmss(cut.totalSeconds)} | ≤ ${mmss(GATE_SECONDS)} | ${verdict} |`);
  rows.push("", "Where each step's end came from:", "");
  for (const s of cut.steps) rows.push(`- ${s.n}: ${s.source}`);
  if (!cut.complete) rows.push("", "PARTIAL: the observer's marks (--start, --install-at, --manifest-at) are needed for a gate verdict.");
  return rows.join("\n");
}

function main(argv) {
  const opts = { os: "linux", start: null, installAt: null, manifestAt: null };
  const paths = [];
  let mode = "markdown";
  const time = (flag, v) => {
    const t = Date.parse(v ?? "");
    if (Number.isNaN(t)) throw new Error(`${flag} needs an ISO 8601 time, e.g. 2026-10-12T10:00:00Z — got '${v ?? ""}'`);
    return t;
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--os") opts.os = argv[++i];
    else if (a === "--start") opts.start = time(a, argv[++i]);
    else if (a === "--install-at") opts.installAt = time(a, argv[++i]);
    else if (a === "--manifest-at") opts.manifestAt = time(a, argv[++i]);
    else if (a === "--json") mode = "json";
    else if (a === "--markdown") mode = "markdown";
    else if (a === "-h" || a === "--help") { process.stdout.write(`${fs.readFileSync(fileURLToPath(import.meta.url), "utf8").split("\n").slice(4, 25).map((l) => l.replace(/^\/\/ ?/, "")).join("\n")}\n`); return 0; }
    else if (a.startsWith("--")) throw new Error(`unknown option ${a}`);
    else paths.push(a);
  }
  const files = paths.flatMap(logFiles);
  if (!files.length) throw new Error(`no gov run log (*.log) under: ${paths.join(", ") || "(no path given)"}`);
  const events = files.flatMap((f) => parseLog(fs.readFileSync(f, "utf8")));
  const cut = cutSteps(events, opts);
  process.stdout.write(mode === "json" ? `${JSON.stringify(cut, null, 2)}\n` : `${markdown(cut)}\n`);
  return 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  try { process.exitCode = main(process.argv.slice(2)); }
  catch (e) { process.stderr.write(`walk-times: ${e.message}\n`); process.exitCode = 2; }
}

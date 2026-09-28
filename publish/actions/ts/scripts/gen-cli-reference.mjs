#!/usr/bin/env node
// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * WRITE THE COMMAND REFERENCE FROM THE SPECS — or say that the committed one no longer matches them.
 *
 * WHY THIS EXISTS. `gov-command-reference.md` was hand-written and drifted: 21 verbs listed of 27 dispatched,
 * `gov-work` as the binary name, and not one exit code anywhere — the field an agent branches on. A reference
 * kept by hand next to a machine-readable spec is a second copy of the truth, and the second copy always loses.
 *
 * THE DIVISION OF LABOUR is the same one the rest of this codebase uses: `src/cli/reference-page.ts` renders
 * (pure, byte-stable, unit-tested), and this script does the IO — find the file, read it, compare, write.
 *
 *   node scripts/gen-cli-reference.mjs            write the page, report where and how much changed
 *   node scripts/gen-cli-reference.mjs --check    write nothing; exit 1 with a diff if it is stale
 *
 * `--check` IS A GATE, unlike catalog-freshness and harness-paths-freshness, which are advisory because they
 * ask the world a question and the world is allowed to have moved. This one compares two things in this
 * repository, so a mismatch is never news — it is a file somebody forgot to regenerate, and the fix is one
 * command. `test/cli/reference-page.test.ts` asserts the same equality inside `npm test`, so CI catches it even
 * where this script is never wired up; the script exists for the human who wants the diff without a test runner.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { COMMAND_SPECS } from "../src/cli/help-spec.js";
import { TOPICS } from "../src/cli/help-render.js";
import { renderReference, REFERENCE_DOC_CANDIDATES } from "../src/cli/reference-page.js";

const check = process.argv.includes("--check");
const quiet = process.argv.includes("--quiet");
const say = (s) => { if (!quiet) process.stdout.write(`${s}\n`); };

const pkgRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * The file that is THERE, or the last candidate if none is.
 *
 * Writing to a path that does not exist when a file of that name sits one directory away is how a repository
 * ends up with two references, one of them stale and linked. So existence decides, and only when nothing exists
 * does the generator create — at the canonical (last) candidate.
 */
function target() {
  const found = REFERENCE_DOC_CANDIDATES.map((p) => join(pkgRoot, p)).find((p) => existsSync(p));
  return found ?? join(pkgRoot, REFERENCE_DOC_CANDIDATES[REFERENCE_DOC_CANDIDATES.length - 1]);
}

/**
 * A line diff, ±3 lines of it.
 *
 * `git diff` would say it better, but this must work in a checkout with unstaged changes and in CI without
 * shelling out — and the answer a reader needs is "what part of the page moved", not every line. The first
 * differing line is named, because a page this long is otherwise a wall of plus and minus.
 */
function diff(before, after) {
  const a = before.split("\n");
  const b = after.split("\n");
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  const setA = new Set(a);
  const setB = new Set(b);
  const removed = a.filter((l) => !setB.has(l) && l.trim());
  const added = b.filter((l) => !setA.has(l) && l.trim());
  const out = [`  first difference at line ${i + 1}`];
  const show = (lines, sign) => {
    for (const l of lines.slice(0, 3)) out.push(`  ${sign} ${l.length > 110 ? `${l.slice(0, 107)}…` : l}`);
    if (lines.length > 3) out.push(`  ${sign} … and ${lines.length - 3} more line(s)`);
  };
  show(removed, "-");
  show(added, "+");
  return out;
}

// UTF-8 BYTES, not `String.length`. The page is full of em dashes, so the two differ by ~230 — and a report
// that says "27790 bytes" about a 28021-byte file is a number nobody can check against `wc -c`.
const bytes = (s) => Buffer.byteLength(s, "utf8");

const path = target();
const rendered = renderReference(COMMAND_SPECS, TOPICS);
const onDisk = existsSync(path) ? readFileSync(path, "utf8") : null;
const rel = path.slice(resolve(pkgRoot, "../..").length + 1);

say(`cli reference — ${COMMAND_SPECS.length} commands and ${TOPICS.length} topics from src/cli/help-spec.ts\n`);

if (onDisk === rendered) {
  say(`  ok  ${rel} is what the specs produce (${bytes(rendered)} bytes)`);
  process.exit(0);
}

if (check) {
  say(onDisk === null
    ? `  ✗  ${rel} does not exist — the reference has never been generated`
    : `  ✗  ${rel} is STALE: it is not what the specs produce now`);
  if (onDisk !== null) for (const l of diff(onDisk, rendered)) say(l);
  say("");
  say("A spec in src/cli/help-spec.ts changed, or this file was hand-edited. Either way the fix is the");
  say("same and the specs win:");
  say("");
  say("  npm run docs:cli");
  say("");
  process.exit(1);
}

mkdirSync(dirname(path), { recursive: true });
writeFileSync(path, rendered);
say(onDisk === null
  ? `  wrote ${rel} (${bytes(rendered)} bytes, new)`
  : `  wrote ${rel} (${bytes(rendered)} bytes, was ${bytes(onDisk)})`);
if (onDisk !== null) for (const l of diff(onDisk, rendered)) say(l);
process.exit(0);

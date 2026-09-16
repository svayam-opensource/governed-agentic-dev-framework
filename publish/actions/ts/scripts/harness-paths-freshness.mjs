#!/usr/bin/env node
// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
//
// DOES EACH AGENT STILL READ THE FILE WE PLACE FOR IT?
//
// Three wrong harness paths shipped, and each was found by a person noticing, not by a test:
//
//   2026-09-11  `.clinerules` mirrored as a FILE where the renderer writes
//               `.clinerules/agent.md` — cline launched with an empty context
//   2026-09-12  `AGENTS.md` inherited from the template, so openai-codex and ibm-bob read this
//               repository's contributor notes instead of the protocol
//   2026-09-15  `.gemini/styleguide.md` is Gemini Code Assist's GitHub CODE-REVIEW file; the
//               `gemini` CLI reads `GEMINI.md`, so Gemini was ungoverned entirely
//
// THE PATTERN, WHICH IS THE POINT. `harnessFileFor`, `ROOT_HARNESS_FILES` and
// `harness-manifest.yaml` are asserted against EACH OTHER by three unit tests. All three are
// gov's own copies of the same belief, so a belief that was wrong about the vendor stayed wrong
// and stayed green. `verifyAgentContext` cannot help either: it checks the file gov PLACED, not
// the file the agent READS.
//
// So this asks the vendor. It downloads each agent's published package and looks for the context
// filename in what the vendor actually ships — the way `promptArgv` was verified for eight
// agents on 2026-09-11, by reading the tool instead of assuming.
//
// ADVISORY, NOT A GATE. A vendor can rename a file between releases and that is news, not a
// build break — the same reasoning as catalog-freshness. It runs weekly and reports.
//
//   node scripts/harness-paths-freshness.mjs [--quiet]

import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Agents whose context file can be checked from a published npm package. Bob installs from a
// vendor tarball and Cursor ships no package, so they are named here as unverifiable rather
// than silently omitted — an absent row reads as "fine".
const WATCH = [
  { id: "claude-code",        pack: "@anthropic-ai/claude-code", expect: "CLAUDE.md" },
  { id: "openai-codex",       pack: "@openai/codex",             expect: "AGENTS.md" },
  { id: "gemini-code-assist", pack: "@google/gemini-cli",        expect: "GEMINI.md" },
  { id: "github-copilot",     pack: "@github/copilot",           expect: ".github/copilot-instructions.md" },
  { id: "cline",              pack: "cline",                     expect: ".clinerules" },
  { id: "continue",           pack: "@continuedev/cli",          expect: ".continue/rules" },
];
const UNVERIFIABLE = [
  { id: "ibm-bob", why: "installs from bob.ibm.com, not npm — check `bob --help` by hand" },
  { id: "cursor",  why: "no published package — check the docs by hand" },
  { id: "aider",   why: "CONVENTIONS.md is passed by flag, not auto-discovered" },
  { id: "windsurf", why: "deferred in the catalog; no CLI verified" },
];

const quiet = process.argv.includes("--quiet");
const say = (s) => { if (!quiet) process.stdout.write(`${s}\n`); };

/**
 * FOLLOW THE LAUNCHER TO THE REAL PACKAGE.
 *
 * `@openai/codex` is 3 files and 20 KB; `cline` is 6 and 64 KB. Both are npm launchers whose
 * actual binary ships in a per-platform `optionalDependencies` entry
 * (`@openai/codex-darwin-arm64`, `@cline/cli-darwin-arm64`, …). Searching the launcher finds
 * nothing and says "path not found", which is a false negative — and four of six false
 * negatives is a checker nobody will read twice.
 */
function platformPackages(pack) {
  try {
    const raw = execFileSync("npm", ["view", pack, "optionalDependencies", "--json"], {
      encoding: "utf8", stdio: ["ignore", "pipe", "ignore"],
    });
    const deps = Object.keys(JSON.parse(raw || "{}"));
    // Only the vendor's own platform builds — never unrelated optional deps like sharp.
    //
    // BOTH SPELLINGS. An unscoped package publishes its platform builds UNDER a scope:
    // `cline` → `@cline/cli-darwin-arm64`. Matching only the bare name missed every one of
    // them, so cline reported "path not found" while `@cline/cli-darwin-arm64` contains
    // `.clinerules` twice — the checker disagreeing with the vendor because of its own filter.
    const bare = pack.startsWith("@") ? pack.split("/")[0] : pack;
    const scopes = [bare, `@${bare}`];
    return deps.filter((d) => scopes.some((x) => d.startsWith(x))
      && /(darwin|linux|win32|windows)-(x64|arm64)/.test(d));
  } catch {
    return [];
  }
}

/**
 * Does `needle` appear anywhere in this package? Searched FILE BY FILE, with an early exit.
 *
 * The first version concatenated every file into one string and regexed that. It reported cline
 * as "path not found" — and `@cline/cli-darwin-arm64` is 92 MB and contains `.clinerules`
 * twice. Building a 92 MB JavaScript string and matching against it is what failed, so the
 * checker was reporting its own scaling limit as a vendor change. That is the worst kind of
 * false negative: indistinguishable from the real finding it exists to surface.
 *
 * Returns `{ hits, searched }`, or null when the package could not be fetched at all — which is
 * "unverifiable", a different answer from "absent".
 */
function findInPackage(pack, needle) {
  const dir = mkdtempSync(join(tmpdir(), "harness-"));
  try {
    execFileSync("npm", ["pack", pack, "--silent", "--pack-destination", dir],
      { stdio: ["ignore", "ignore", "ignore"] });
    const tgz = readdirSync(dir).find((f) => f.endsWith(".tgz"));
    if (!tgz) return null;
    execFileSync("tar", ["-xzf", join(dir, tgz), "-C", dir], { stdio: "ignore" });
    const walk = (d) => readdirSync(d, { withFileTypes: true }).flatMap((e) => {
      const p = join(d, e.name);
      return e.isDirectory() ? walk(p) : [p];
    });
    let hits = 0;
    for (const f of walk(join(dir, "package"))) {
      let text;
      // latin1 so an ASCII filename inside a compiled binary still matches and nothing throws.
      try { text = readFileSync(f).toString("latin1"); } catch { continue; }
      let i = text.indexOf(needle);
      while (i !== -1) { hits++; i = text.indexOf(needle, i + needle.length); }
      if (hits > 0) break;                        // one confirmation is the whole question
    }
    return { hits, searched: pack };
  } catch {
    return null;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

let stale = 0;
let unchecked = 0;
say("harness paths — what each vendor's own package says it reads\n");
for (const w of WATCH) {
  let r = findInPackage(w.pack, w.expect);
  let platformsTried = 0;
  let platformsFetched = 0;
  if (r !== null && r.hits === 0) {
    // Launcher, most likely: `@openai/codex` is 3 files and 20 KB, `cline` is 6 and 64 KB, and
    // the real binary ships in a per-platform optionalDependency. Try those before concluding.
    for (const plat of platformPackages(w.pack)) {
      platformsTried++;
      const pr = findInPackage(plat, w.expect);
      if (pr === null) continue;                  // could not fetch this build
      platformsFetched++;
      if (pr.hits > 0) { r = pr; break; }
    }
    // ABSENT FROM A LAUNCHER IS NOT ABSENT. If the real binary lives in platform builds and NONE
    // of them could be fetched, the honest answer is "unverified" — the launcher never contained
    // the string and was never going to.
    if (r.hits === 0 && platformsTried > 0 && platformsFetched === 0) r = null;
  }
  if (r === null) {
    say(`  ?  ${w.id.padEnd(20)} UNVERIFIED — ${platformsTried > 0
      ? `${w.pack} is a launcher and none of its ${platformsTried} platform build(s) could be fetched`
      : `could not fetch ${w.pack}`}`);
    unchecked++;
  } else if (r.hits > 0) {
    say(`  ok ${w.id.padEnd(20)} ${w.expect} — found in ${r.searched}`);
  } else {
    say(`  ✗  ${w.id.padEnd(20)} ${w.expect} NOT found in ${w.pack} or its platform builds`);
    say(`     READ THE TOOL before changing anything — this is a lead, not a verdict.`);
    stale++;
  }
}
say("");
for (const u of UNVERIFIABLE) say(`  –  ${u.id.padEnd(20)} not checkable here — ${u.why}`);
say("");
say(stale === 0
  ? `every checkable harness path still appears in its vendor's package${unchecked ? ` (${unchecked} unverified)` : ""}.`
  : `${stale} path(s) to investigate by reading the tool. Absent from a package is a LEAD, not a\n`
    + `verdict: three of the four the first version of this script flagged were its own false\n`
    + `negatives, not vendor changes.`);
// Advisory: never fail the build. A rename is news.
process.exit(0);

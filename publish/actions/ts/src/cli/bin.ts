#!/usr/bin/env node
// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
// The `gov` executable entry (Node/TS) — the project and workspace CLI of the Governed Agentic
// Development Framework. It manages projects, workspaces and org registration, and shows the context
// banner. It hosts NOTHING: `gov-cicd` (deploy) and `gov-infra` (infrastructure) are independent clients
// invoked directly, not verbs of this one (adr-three-clients, PRJ-43).
import { main, runSetupCommand, runWork, runMainMenu, runFirstRunIfNeeded, readCliVersion, helpLines } from "./main.js";
import { confirmContextOrBail } from "./context-gate.js";

const argv = process.argv.slice(2);

async function dispatch(): Promise<number> {
  // Meta flags — no workspace/plugin/context needed (an adopter's first commands).
  if (argv[0] === "--version" || argv[0] === "-v") { process.stdout.write(`gov ${readCliVersion()}\n`); return 0; }
  if ((argv[0] === "--help" || argv[0] === "-h") && argv.length === 1) { for (const l of helpLines()) process.stdout.write(`${l}\n`); return 0; }

  // FIRST RUN — before the banner, which would otherwise announce "no gov workspace resolved" and hand the
  // work back with two verbs to learn.
  //
  // Only with a TERMINAL. First run is a human act (Policy Owner, 2026-08-07), and gating it here rather
  // than letting it report "blocked" keeps a bare non-TTY machine behaving exactly as it does today: the
  // commands that genuinely need no workspace (`bump-version`, `doctor --home`, `validate`) still run, and
  // the ones that do need one still fail with their own message. `gov work` prints the blocked message on
  // its own path, so nothing is lost.
  //
  // `setup` and `org` are exempt: they are how you fix the registry by hand, and intercepting them would
  // make the manual path unreachable.
  if (process.stdin.isTTY && argv[0] !== "setup" && argv[0] !== "org") {
    const first = await runFirstRunIfNeeded();
    if (first !== null) return first;   // null = already set up; anything else is this invocation's answer
  }

  // context banner + prompt-on-context-change (bail = 0), then dispatch.
  if (!(await confirmContextOrBail(argv))) return 0;
  if (argv.length === 0 && process.stdin.isTTY) return runMainMenu();
  if (argv[0] === "setup") return runSetupCommand(argv);
  if (argv[0] === "work") return runWork(argv);   // prompts + launches — see runWork
  return main(argv);
}

dispatch().then((code) => process.exit(code)).catch((e) => { process.stderr.write(`${(e as Error)?.stack ?? e}\n`); process.exit(1); });

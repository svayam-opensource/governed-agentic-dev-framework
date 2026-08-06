#!/usr/bin/env node
// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
// The `gov` executable entry (Node/TS) — the project and workspace CLI of the Governed Agentic
// Development Framework. It manages projects, workspaces and org registration, and shows the context
// banner. It hosts NOTHING: `gov-cicd` (deploy) and `gov-infra` (infrastructure) are independent clients
// invoked directly, not verbs of this one (adr-three-clients, PRJ-43).
import { main, runSetupCommand, runMainMenu, readCliVersion, helpLines } from "./main.js";
import { confirmContextOrBail } from "./context-gate.js";

const argv = process.argv.slice(2);

async function dispatch(): Promise<number> {
  // Meta flags — no workspace/plugin/context needed (an adopter's first commands).
  if (argv[0] === "--version" || argv[0] === "-v") { process.stdout.write(`gov ${readCliVersion()}\n`); return 0; }
  if ((argv[0] === "--help" || argv[0] === "-h") && argv.length === 1) { for (const l of helpLines()) process.stdout.write(`${l}\n`); return 0; }

  // context banner + prompt-on-context-change (bail = 0), then dispatch.
  if (!(await confirmContextOrBail(argv))) return 0;
  if (argv.length === 0 && process.stdin.isTTY) return runMainMenu();
  if (argv[0] === "setup") return runSetupCommand(argv);
  return main(argv);
}

dispatch().then((code) => process.exit(code)).catch((e) => { process.stderr.write(`${(e as Error)?.stack ?? e}\n`); process.exit(1); });

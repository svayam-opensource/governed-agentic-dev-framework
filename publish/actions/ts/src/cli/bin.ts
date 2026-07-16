#!/usr/bin/env node
// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
// The `gov` executable entry (Node/TS) — the unified CLI for the Governed Agentic Development Framework.
// gov-work (OSS) is the HOST: it manages projects, workspaces, and credentials, shows the context banner,
// and DELEGATES governed verbs (catalog/deploy/…) to the internal `gov-operate` plugin when installed —
// runtime discovery only, so gov-work keeps NO build dependency on it. (Also published as `gov-work`.)
import { main, runSetupCommand, runCredsCommand, runMainMenu, readCliVersion, helpLines } from "./main.js";
import { runAuthCommand } from "./auth.js";
import { isGovernedInvocation, delegateToGovOperate, confirmContextOrBail } from "./host.js";

const argv = process.argv.slice(2);

async function dispatch(): Promise<number> {
  // Meta flags — no workspace/plugin/context needed (an adopter's first commands).
  if (argv[0] === "--version" || argv[0] === "-v") { process.stdout.write(`gov ${readCliVersion()}\n`); return 0; }
  if ((argv[0] === "--help" || argv[0] === "-h") && argv.length === 1) { for (const l of helpLines()) process.stdout.write(`${l}\n`); return 0; }

  // GOVERNED verbs → delegate to the internal gov-operate plugin (it shows its OWN banner). Runtime
  // discovery only; gov-work has no build dependency on gov-operate (the OSS boundary holds).
  if (isGovernedInvocation(argv)) return delegateToGovOperate(argv);

  // CORE (gov-work) commands: context banner + prompt-on-context-change (bail = 0), then dispatch.
  if (!(await confirmContextOrBail(argv))) return 0;
  if (argv.length === 0 && process.stdin.isTTY) return runMainMenu();
  if (argv[0] === "setup") return runSetupCommand(argv);
  if (argv[0] === "creds") return runCredsCommand(argv);
  if (argv[0] === "auth") return runAuthCommand(argv);
  return main(argv);
}

dispatch().then((code) => process.exit(code)).catch((e) => { process.stderr.write(`${(e as Error)?.stack ?? e}\n`); process.exit(1); });

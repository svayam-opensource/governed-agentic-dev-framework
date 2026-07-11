#!/usr/bin/env node
// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
// The `gov-work` executable entry (Node/TS) — the OSS project/workflow CLI for the Governed Agentic
// Development Framework. Standalone: it manages projects, workspaces, and credentials. Enterprise
// catalog/deploy is a SEPARATE CLI (`gov-operate`) — gov-work has no knowledge of it.
// No args on a TTY → the interactive menu; `setup` → the async bootstrap; else the command.
import { main, runSetupCommand, runCredsCommand, runMainMenu, readCliVersion, helpLines } from "./main.js";
import { runAuthCommand } from "./auth.js";

const argv = process.argv.slice(2);

// Meta flags must work WITHOUT a resolved workspace (an adopter's first commands).
if (argv[0] === "--version" || argv[0] === "-v") {
  process.stdout.write(`gov-work ${readCliVersion()}\n`);
  process.exit(0);
} else if ((argv[0] === "--help" || argv[0] === "-h") && argv.length === 1) {
  for (const l of helpLines()) process.stdout.write(`${l}\n`);
  process.exit(0);
} else if (argv.length === 0 && process.stdin.isTTY) {
  runMainMenu().then((code) => process.exit(code));
} else if (argv[0] === "setup") {
  runSetupCommand(argv).then((code) => process.exit(code));
} else if (argv[0] === "creds") {
  runCredsCommand(argv).then((code) => process.exit(code));
} else if (argv[0] === "auth") {
  runAuthCommand(argv).then((code) => process.exit(code));
} else {
  process.exit(main(argv));
}

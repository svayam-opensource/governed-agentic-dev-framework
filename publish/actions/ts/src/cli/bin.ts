#!/usr/bin/env node
// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
// The `gov` executable entry (Node/TS) — the bin of @svayam-opensource/gov, the
// OSS governance CLI (unit gov-work). Succeeds the frozen bash @svayam-opensource/prj.
// No args on a TTY → the interactive menu; `setup` → the async bootstrap;
// enterprise commands (deploy/catalog/…) → the gov-operate plugin seam; else the command.
import { main, runSetupCommand, runPluginCli, runMainMenu, readCliVersion, helpLines } from "./main.js";
import { isPluginCommand } from "../plugin/loader.js";

const argv = process.argv.slice(2);

// Meta flags must work WITHOUT a resolved workspace (an adopter's first commands).
if (argv[0] === "--version" || argv[0] === "-v") {
  process.stdout.write(`gov ${readCliVersion()}\n`);
  process.exit(0);
} else if ((argv[0] === "--help" || argv[0] === "-h") && argv.length === 1) {
  for (const l of helpLines()) process.stdout.write(`${l}\n`);
  process.exit(0);
} else if (argv.length === 0 && process.stdin.isTTY) {
  runMainMenu().then((code) => process.exit(code));
} else if (argv[0] === "setup") {
  runSetupCommand(argv).then((code) => process.exit(code));
} else if (argv[0] !== undefined && isPluginCommand(argv[0])) {
  runPluginCli(argv).then((code) => process.exit(code));
} else {
  process.exit(main(argv));
}

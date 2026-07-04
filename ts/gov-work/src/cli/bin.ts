#!/usr/bin/env node
// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
// The `gov` executable entry (Node/TS) — the bin of @svayam-opensource/gov, the
// OSS governance CLI (unit gov-work). Succeeds the frozen bash @svayam-opensource/prj.
// No args on a TTY → the interactive menu; `setup` → the async bootstrap; else the command.
import { main, runSetupCommand } from "./main.js";
import { runMenu } from "./menu.js";

const argv = process.argv.slice(2);
if (argv.length === 0 && process.stdin.isTTY) {
  runMenu((a) => main(a)).then((code) => process.exit(code));
} else if (argv[0] === "setup") {
  runSetupCommand(argv).then((code) => process.exit(code));
} else {
  process.exit(main(argv));
}

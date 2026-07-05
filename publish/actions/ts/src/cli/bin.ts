#!/usr/bin/env node
// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
// The `gov` executable entry (Node/TS) — the bin of @svayam-opensource/gov, the
// OSS governance CLI (unit gov-work). Succeeds the frozen bash @svayam-opensource/prj.
// No args on a TTY → the interactive menu; `setup` → the async bootstrap;
// enterprise commands (deploy/catalog/…) → the gov-operate plugin seam; else the command.
import { main, runSetupCommand, runPluginCli, gatherMenuContext } from "./main.js";
import { runMenu } from "./menu.js";
import { isPluginCommand } from "../plugin/loader.js";

const argv = process.argv.slice(2);

/** Route any command chosen from the menu (setup / enterprise plugin / normal). */
const runAny = (a: readonly string[]): Promise<number> | number => {
  if (a[0] === "setup") return runSetupCommand(a);
  if (a[0] !== undefined && isPluginCommand(a[0])) return runPluginCli(a);
  return main(a);
};

if (argv.length === 0 && process.stdin.isTTY) {
  gatherMenuContext()
    .then((ctx) => runMenu(ctx, runAny))
    .then((code) => process.exit(code));
} else if (argv[0] === "setup") {
  runSetupCommand(argv).then((code) => process.exit(code));
} else if (argv[0] !== undefined && isPluginCommand(argv[0])) {
  runPluginCli(argv).then((code) => process.exit(code));
} else {
  process.exit(main(argv));
}

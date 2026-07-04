#!/usr/bin/env node
// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
// The `prj` executable entry (Node/TS). At cutover, the framework root bin/prj
// is repointed here. No args on a TTY → the interactive menu; else run the command.
import { main } from "./main.js";
import { runMenu } from "./menu.js";

const argv = process.argv.slice(2);
if (argv.length === 0 && process.stdin.isTTY) {
  runMenu((a) => main(a)).then((code) => process.exit(code));
} else {
  process.exit(main(argv));
}

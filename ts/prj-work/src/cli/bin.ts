#!/usr/bin/env node
// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
// The `prj` executable entry (Node/TS). At cutover, the framework root bin/prj
// is repointed here.
import { main } from "./main.js";

process.exit(main(process.argv.slice(2)));

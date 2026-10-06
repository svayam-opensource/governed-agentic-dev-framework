// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * A {@link HarnessSource} for tests: the default branch's `agent/harness/` is whatever the fixture placed at
 * `<worktree>/agent/harness/` — so a fixture that writes "the rendered harness" models it as COMMITTED on the
 * default branch, which is the only place the mirror reads it from (GOV-FRM-456). Tests that need the worktree
 * and the default branch to differ build their own git double.
 */
import * as path from "node:path";
import type { Fs } from "../../src/lifecycle/fs-io.js";
import { HARNESS_SRC_DIR, ROOT_HARNESS_FILES, type HarnessSource } from "../../src/lifecycle/root-protocol.js";

export function harnessAtDefault(fs: Pick<Fs, "readFile">, branch = "main"): HarnessSource {
  const dir = HARNESS_SRC_DIR.split(path.sep).join("/");
  return {
    defaultBranch: branch,
    git: (repo, args) => {
      if (args[0] === "rev-parse") return args[3] === `${branch}^{commit}` ? "abc1234" : null;
      if (args[0] === "ls-tree") {
        return ROOT_HARNESS_FILES.filter((rel) => fs.readFile(path.join(repo, HARNESS_SRC_DIR, rel)) !== null)
          .map((rel) => `${dir}/${rel}`).join("\n");
      }
      if (args[0] === "show") return fs.readFile(path.join(repo, args[1]!.slice(`${branch}:`.length)));
      return null;
    },
  };
}

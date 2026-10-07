// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
//
// write-build-identity.mjs runs inside `npm pack --json` (prepack → build → postbuild), and gov-cicd parses that
// stdout as JSON. A log line on stdout broke every deploy of gov on 2026-10-07. Its stdout must stay EMPTY.
import { expect } from "chai";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

describe("the build-identity step keeps npm pack --json parseable", () => {
  it("writes nothing to stdout (its message goes to stderr)", () => {
    const root = fileURLToPath(new URL("../../", import.meta.url));
    const r = spawnSync(process.execPath, ["scripts/write-build-identity.mjs"], { cwd: root, encoding: "utf8" });
    expect(r.status, r.stderr).to.equal(0);
    expect(r.stdout).to.equal("");
    expect(r.stderr).to.match(/build identity/);
  });
});

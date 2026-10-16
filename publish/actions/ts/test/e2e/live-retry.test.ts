// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * e2e/live-retry.sh — the live journeys' bounded retries for GitHub's own failures (adopter-e2e run 38754541610):
 *   • push_retry: `! [remote rejected] e2e/policy -> e2e/policy (failed)` on a fresh repo is tried again (3 tries);
 *     a rejection that is ours (non-fast-forward) fails at once, with git's words.
 *   • board_lists: polls a board until it lists an item (the project index lagged > 90 s behind a new anchor).
 * Driven with a fake `git` / `gh` answering from a sequence of recorded replies.
 */
import { expect } from "chai";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const LIB = path.resolve(import.meta.dirname, "../../e2e/live-retry.sh");
const FAILED = " ! [remote rejected] e2e/policy -> e2e/policy (failed)\nerror: failed to push some refs";
const NON_FF = " ! [rejected] main -> main (non-fast-forward)\nerror: failed to push some refs";

// Reply n is `r<n>` in the dir: first line the exit code, the rest the output (the last reply repeats).
const FAKE = (out: "stdout" | "stderr") => `#!/usr/bin/env bash
echo "$*" >> "$FAKE_DIR/calls.log"
n=$(cat "$FAKE_DIR/n" 2>/dev/null || echo 0); n=$((n+1)); echo $n > "$FAKE_DIR/n"
f="$FAKE_DIR/r$n"; [ -f "$f" ] || f="$(ls "$FAKE_DIR"/r* | sort -V | tail -1)"
tail -n +2 "$f" >&${out === "stdout" ? 1 : 2}; exit "$(head -1 "$f")"
`;

function run(tool: "git" | "gh", replies: [number, string][], call: string) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "live-retry-"));
  fs.mkdirSync(path.join(dir, "bin"));
  fs.writeFileSync(path.join(dir, "bin", tool), FAKE(tool === "git" ? "stderr" : "stdout"), { mode: 0o755 });
  replies.forEach(([code, text], i) => fs.writeFileSync(path.join(dir, `r${i + 1}`), `${code}\n${text}\n`));
  const r = spawnSync("bash", ["-c", `set -euo pipefail; . "${LIB}"; ${call}`], {
    encoding: "utf8", env: { PATH: `${path.join(dir, "bin")}:${process.env.PATH}`, FAKE_DIR: dir, LIVE_RETRY_PAUSE: "0" },
  });
  const calls = fs.existsSync(path.join(dir, "calls.log")) ? fs.readFileSync(path.join(dir, "calls.log"), "utf8").trim().split("\n") : [];
  fs.rmSync(dir, { recursive: true, force: true });
  return { status: r.status, err: r.stderr, calls };
}

describe("e2e/live-retry.sh — bounded retries for GitHub's own failures", () => {
  it("push_retry: GitHub's `(failed)` rejection, then success → pushed on the second try", () => {
    const r = run("git", [[1, FAILED], [0, ""]], "push_retry /g e2e/policy");
    expect(r.status, r.err).to.equal(0);
    expect(r.calls).to.deep.equal(["-C /g push -q -u origin e2e/policy", "-C /g push -q -u origin e2e/policy"]);
    expect(r.err).to.match(/refused it on its side \(try 1\/3\)/);
  });

  it("push_retry: three server-side failures → fails after 3 tries with git's words", () => {
    const r = run("git", [[1, FAILED]], "push_retry /g e2e/policy");
    expect(r.status).to.equal(1);
    expect(r.calls).to.have.length(3);
    expect(r.err).to.match(/failed \(try 3\/3\): .*remote rejected/);
  });

  it("push_retry: a rejection that is ours (non-fast-forward) fails at once", () => {
    const r = run("git", [[1, NON_FF]], "push_retry /g main");
    expect(r.status).to.equal(1);
    expect(r.calls).to.have.length(1);
    expect(r.err).to.match(/non-fast-forward/);
  });

  it("board_lists: the item appears on the third poll → 0", () => {
    const A = "https://github.com/svayam-e2e/x-gov/issues/2";
    const r = run("gh", [[0, ""], [0, "https://github.com/svayam-e2e/x-gov/issues/9"], [0, A]], `board_lists svayam-e2e 96 ${A} 60 0`);
    expect(r.status, r.err).to.equal(0);
    expect(r.calls).to.have.length(3);
    expect(r.calls[0]).to.match(/^project item-list 96 --owner svayam-e2e/);
  });

  it("board_lists: never listed within the bound → 1 (an unreadable board counts as not listed)", () => {
    const r = run("gh", [[1, "HTTP 502"]], `board_lists svayam-e2e 96 https://github.com/o/r/issues/2 0 0`);
    expect(r.status).to.equal(1);
    expect(r.calls).to.have.length(1);
  });
});

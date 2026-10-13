// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * e2e/token-probe.sh — the live adopter journey's board poll and token probe (PRJ-121 intent 05, Item 5, ruling Q6).
 *
 * The journey added an issue to a fresh board, then polled the board for items with readable `content`, and on
 * 2026-10-07 saw 0 for three minutes, reproducibly. Two different things look the same to that poll:
 *   • NO ITEMS yet — GitHub's project index is eventually consistent: wait (cap 3 min);
 *   • ITEMS WHOSE CONTENT IS NULL (or REDACTED) — the item is there and the token cannot read the issue behind it,
 *     e.g. a fine-grained token limited to selected repositories, which never includes a repo created during the run.
 *     Waiting cannot fix that: die at once, naming the repo and the token's kind.
 * Driven here with a fake `gh` that answers the GraphQL poll from a sequence of recorded responses.
 */
import { expect } from "chai";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const LIB = path.resolve(import.meta.dirname, "../../e2e/token-probe.sh");

const item = (content: unknown, type = "ISSUE") => ({ type, content });
const page = (nodes: unknown[]) => JSON.stringify({ data: { organization: { projectV2: { items: { nodes } } } } });
const ISSUE = { __typename: "Issue", number: 1, repository: { nameWithOwner: "svayam-e2e/gov-e2e-1-svc" } };

// Each call to `gh api graphql` returns the next response (the last one repeats); `gh api -i user` returns headers.
const FAKE_GH = `#!/usr/bin/env bash
echo "$*" >> "$PROBE_DIR/calls.log"
if [ "$1 $2" = "api graphql" ]; then
  n=$(cat "$PROBE_DIR/n" 2>/dev/null || echo 0); n=$((n+1)); echo $n > "$PROBE_DIR/n"
  f="$PROBE_DIR/r$n.json"; [ -f "$f" ] || f="$(ls "$PROBE_DIR"/r*.json | sort -V | tail -1)"; cat "$f"; exit 0
fi
if [ "$1 $2" = "project item-add" ]; then echo '{"id":"PVTI_again"}'; exit 0; fi
if [ "$1 $2" = "api -i" ]; then printf 'HTTP/2.0 200 OK\\r\\n%s\\r\\n\\r\\n{}' "$PROBE_HEADER"; exit 0; fi
echo "fake gh: unexpected: $*" >&2; exit 97
`;

function poll(responses: string[], env: Record<string, string> = {}): { status: number | null; out: string; calls: string; polls: number } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "board-poll-"));
  fs.mkdirSync(path.join(dir, "bin"));
  fs.writeFileSync(path.join(dir, "bin", "gh"), FAKE_GH, { mode: 0o755 });
  responses.forEach((r, i) => fs.writeFileSync(path.join(dir, `r${i + 1}.json`), r));
  const r = spawnSync("bash", ["-c", `set -euo pipefail; source "${LIB}"; board_poll svayam-e2e 7 svayam-e2e/gov-e2e-1-svc`], {
    env: { PATH: `${path.join(dir, "bin")}${path.delimiter}${process.env.PATH ?? ""}`, PROBE_DIR: dir, GITHUB_ACTIONS: "true",
      BOARD_POLL_SLEEP: "0", GH_TOKEN: "github_pat_FAKE", PROBE_HEADER: "Content-Type: application/json", ...env },
    encoding: "utf8",
  });
  const calls = fs.existsSync(path.join(dir, "calls.log")) ? fs.readFileSync(path.join(dir, "calls.log"), "utf8") : "";
  const polls = Number(fs.existsSync(path.join(dir, "n")) ? fs.readFileSync(path.join(dir, "n"), "utf8") : 0);
  fs.rmSync(dir, { recursive: true, force: true });
  return { status: r.status, out: `${r.stdout}${r.stderr}`, calls, polls };
}

describe("e2e/token-probe.sh board_poll", function () {
  this.timeout(30_000);
  if (process.platform === "win32") return;

  it("items whose content is null: dies on the FIRST poll with the token message — never waits it out", () => {
    const r = poll([page([item(null)])]);
    expect(r.status, r.out).to.not.equal(0);
    expect(r.polls).to.equal(1);
    expect(r.out).to.match(/::error::.*token cannot read svayam-e2e\/gov-e2e-1-svc — fine-grained/);
  });

  it("a REDACTED item counts as unreadable too", () => {
    const r = poll([page([item(null, "REDACTED")])]);
    expect(r.status).to.not.equal(0);
    expect(r.out).to.include("token cannot read svayam-e2e/gov-e2e-1-svc");
  });

  it("the kind names a classic token by its scopes", () => {
    const r = poll([page([item(null)])], { GH_TOKEN: "ghp_FAKE", PROBE_HEADER: "X-Oauth-Scopes: repo, project, read:org" });
    expect(r.out).to.match(/token cannot read .* — classic \(scopes: repo, project, read:org\)/);
  });

  it("zero items, then one: waits (index latency) and passes, saying on which poll it appeared", () => {
    const r = poll([page([]), page([]), page([item(ISSUE)])]);
    expect(r.status, r.out).to.equal(0);
    expect(r.polls).to.equal(3);
    expect(r.out).to.match(/board shows 1 linked item\(s\) on poll 3/);
  });

  it("zero items until the cap: dies naming GitHub's index, not the token", () => {
    const r = poll([page([])], { BOARD_POLL_MAX: "4" });
    expect(r.status).to.not.equal(0);
    expect(r.polls).to.equal(4);
    expect(r.out).to.match(/::error::.*no item on the board after 4 polls/);
    expect(r.out).to.not.include("token cannot read");
  });

  // 2026-10-13: three live runs saw an empty board for the whole window after a successful item-add.
  it("zero items until the cap, with the added item known: says whether it exists, re-adds once, and polls again", () => {
    const empty = page([]);
    const r = poll([empty, empty, empty, empty, JSON.stringify({ data: { node: null } }), page([item(ISSUE)])],
      { BOARD_POLL_MAX: "4", ISSUE_URL: "https://github.com/svayam-e2e/gov-e2e-1-svc/issues/1", ITEM_ID: "PVTI_x" });
    expect(r.status, r.out).to.equal(0);
    expect(r.out).to.include("item PVTI_x by id:");
    expect(r.out).to.include("re-adding https://github.com/svayam-e2e/gov-e2e-1-svc/issues/1 to board #7");
    expect(r.calls).to.include("project item-add 7 --owner svayam-e2e");
  });

  it("…and only once: still empty after the re-add, it dies naming GitHub's index", () => {
    const r = poll([page([])], { BOARD_POLL_MAX: "2", ISSUE_URL: "https://github.com/o/r/issues/1" });
    expect(r.status).to.not.equal(0);
    expect((r.calls.match(/project item-add/g) ?? []).length).to.equal(1);
    expect(r.out).to.match(/::error::.*no item on the board after 2 polls/);
  });

  it("a GraphQL error is not mistaken for zero items: it is named", () => {
    const r = poll([JSON.stringify({ errors: [{ message: "Resource not accessible by personal access token" }] })], { BOARD_POLL_MAX: "2" });
    expect(r.status).to.not.equal(0);
    expect(r.out).to.include("Resource not accessible by personal access token");
  });

  it("the default cap is 3 minutes: 60 polls 3 s apart", () => {
    const src = fs.readFileSync(LIB, "utf8");
    expect(src).to.match(/BOARD_POLL_MAX:-60\b/).and.match(/BOARD_POLL_SLEEP:-3\b/);
  });
});

describe("e2e/token-probe.sh token_kind", function () {
  if (process.platform === "win32") return;
  const kind = (token: string, header: string): string =>
    spawnSync("bash", ["-c", `source "${LIB}"; token_kind "$1"`, "_", header], { env: { PATH: process.env.PATH, GH_TOKEN: token }, encoding: "utf8" }).stdout.trim();

  it("classifies by the token's prefix and the x-oauth-scopes header — never prints the token", () => {
    expect(kind("ghp_SECRETVALUE", "X-Oauth-Scopes: repo")).to.equal("classic (scopes: repo)");
    expect(kind("github_pat_SECRETVALUE", "")).to.equal("fine-grained");
    expect(kind("ghs_SECRETVALUE", "")).to.equal("app-installation");
    expect(kind("SECRETVALUE", "")).to.equal("unknown");
    for (const t of ["ghp_SECRETVALUE", "github_pat_SECRETVALUE"]) expect(kind(t, "")).to.not.include("SECRETVALUE");
  });
});

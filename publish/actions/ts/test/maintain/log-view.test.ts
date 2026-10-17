// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * `gov log` — one file per run is only useful if the files can be found (PRJ-121, 2026-09-23).
 * A failure names a run's folder; this is how someone gets back to it an hour later.
 */
import { expect } from "chai";
import { formatRuns, listRuns, parseRunFolder, selectRuns, type LogFs } from "../../src/maintain/log-view.js";

const ROOT = "/w/preferences/rk/state/logs";
const tree: Record<string, string[]> = {
  [ROOT]: ["2026-09-21", "2026-09-23", "notes.txt"],
  [`${ROOT}/2026-09-23`]: ["184107-7f3a-PRJ-121-doc-update-issue-116-work", "184108-c19e-PRJ-119-gov-iam-merge", "something-else"],
  [`${ROOT}/2026-09-21`]: ["090000-a02b-none-doctor"],
};
const fs: LogFs = { list: (d) => tree[d] ?? [] };

describe("gov log — the runs this machine kept", () => {
  it("reads a run folder's name back into its parts", () => {
    const e = parseRunFolder("2026-09-23", "184107-7f3a-PRJ-121-doc-work", ROOT)!;
    expect(e).to.include({ day: "2026-09-23", time: "184107", id: "7f3a", project: "PRJ-121-doc", command: "work" });
    expect(e.dir).to.equal(`${ROOT}/2026-09-23/184107-7f3a-PRJ-121-doc-work`);
  });

  it("ignores anything gov did not name", () => {
    expect(parseRunFolder("2026-09-23", "something-else", ROOT)).to.equal(null);
    expect(listRuns(fs, ROOT).map((r) => r.id), "and a stray file in the logs root").to.deep.equal(["c19e", "7f3a", "a02b"]);
  });

  it("lists newest first, across days", () => {
    const runs = listRuns(fs, ROOT);
    expect(runs[0]!.day).to.equal("2026-09-23");
    expect(runs[0]!.time).to.equal("184108");
    expect(runs[runs.length - 1]!.day).to.equal("2026-09-21");
  });

  it("finds one run by the id a failure printed", () => {
    expect(selectRuns(listRuns(fs, ROOT), { runId: "a02b" }).map((r) => r.command)).to.deep.equal(["doctor"]);
  });

  it("narrows to a project, by part of its name", () => {
    expect(selectRuns(listRuns(fs, ROOT), { project: "prj-119" }).map((r) => r.id)).to.deep.equal(["c19e"]);
  });

  it("--last is the newest run, whatever it was", () => {
    expect(selectRuns(listRuns(fs, ROOT), { last: true }).map((r) => r.id)).to.deep.equal(["c19e"]);
  });

  it("prints one readable line per run, and says so when there are none", () => {
    const lines = formatRuns(listRuns(fs, ROOT));
    expect(lines[0]).to.contain("2026-09-23 18:41:08").and.contain("c19e").and.contain("merge");
    expect(formatRuns([])).to.deep.equal(["  no runs recorded yet"]);
  });
});

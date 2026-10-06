// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
//
// `gov rules show <id>` (W3, rule-model-design.md Q21): a GOV id prints its row; a retired POL number resolves
// through framework/rules/pol-aliases.yaml to the row that carries it now, or to the reason none does. Read
// against the SHIPPED content, so the command and the files cannot drift apart unnoticed.
import { expect } from "chai";
import { readFileSync } from "node:fs";
import * as path from "node:path";
import { showRule } from "../../src/cli/rules-show.js";
import { parseArgv } from "../../src/cli/args.js";
import { route, type CliContext } from "../../src/cli/dispatch.js";
import type { Fs } from "../../src/lifecycle/fs-io.js";

const CONTENT = path.join(import.meta.dirname, "..", "..", "..", "..", "content");
const read = (rel: string): string | null => {
  try { return readFileSync(path.join(CONTENT, rel), "utf8"); } catch { return null; }
};

describe("gov rules show", () => {
  it("prints a GOV-FRM row", () => {
    const r = showRule(read, "GOV-FRM-012");
    expect(r.code).to.equal(0);
    expect(r.lines.join("\n")).to.match(/GOV-FRM-012 · C01 · agent/).and.match(/stops all work/);
  });

  it("resolves a surviving POL number to its row", () => {
    const r = showRule(read, "POL-086b");
    expect(r.code).to.equal(0);
    expect(r.lines[0]).to.match(/POL-086b is now GOV-FRM-086/);
    expect(r.lines.join("\n")).to.match(/never follows or cites its own unmerged edit/);
  });

  it("resolves a split POL number to every row it became", () => {
    const out = showRule(read, "POL-044").lines.join("\n");
    expect(out).to.match(/GOV-FRM-044/).and.match(/GOV-FRM-451/);
  });

  it("resolves a folded POL number to the row that absorbed it", () => {
    const r = showRule(read, "POL-013");
    expect(r.code).to.equal(0);
    expect(r.lines[0]).to.match(/POL-013 was folded into GOV-FRM-012/);
  });

  it("resolves an old dotted label (repo protect's POL-040a.2) through its base", () => {
    expect(showRule(read, "POL-040a.2").lines[0]).to.match(/POL-040a is now GOV-FRM-447/);
  });

  it("prints the reason for a dropped number, and the pending note for an organization clause", () => {
    const dropped = showRule(read, "POL-028");
    expect(dropped.code).to.equal(0);
    expect(dropped.lines[0]).to.match(/POL-028 was dropped: a definition/);
    expect(showRule(read, "POL-210").lines[0]).to.match(/POL-210 is an organization clause: pending — issued at first propose/);
  });

  it("names a GOV target that is not issued yet, rather than printing nothing", () => {
    expect(showRule(read, "POL-143").lines.join("\n")).to.match(/GOV-SVM-143.*no row/);
  });

  it("exits 1 on an unknown id and 2 on something that is no id at all", () => {
    expect(showRule(read, "POL-777").code).to.equal(1);
    expect(showRule(read, "GOV-FRM-999").code).to.equal(1);
    expect(showRule(read, "banana").code).to.equal(2);
  });

  it("is wired into `gov rules show <id>`", () => {
    const fs: Fs = {
      pathExists: () => false, mkdirp: () => {}, writeFile: () => {}, rm: () => {}, readdir: () => [],
      readFile: (p: string) => read(path.relative("/home", p)),
    };
    const ctx = { home: "/home", fs, login: "x", seededBy: "x", config: { defaultBranch: "main" } } as unknown as CliContext;
    const r = route(parseArgv(["rules", "show", "POL-086b"]) as never, ctx);
    expect(r.code).to.equal(0);
    expect(r.lines[0]).to.match(/GOV-FRM-086/);
    expect(route(parseArgv(["rules", "show"]) as never, ctx).code).to.equal(2);
  });
});

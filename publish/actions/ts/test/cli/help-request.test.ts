// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * HELP NEVER ACTS (PRJ-121, 2026-09-22). `gov merge -h` attempted a merge; `gov work --help` started the work
 * flow; `gov help <cmd>` was "unknown command 'help'". helpRequest decides, before anything runs.
 */
import { expect } from "chai";
import { helpRequest } from "../../src/cli/help-request.js";

describe("helpRequest — help is recognised before any command runs", () => {
  it("gov help / gov --help / gov -h → the overview", () => {
    for (const a of [["help"], ["--help"], ["-h"]]) expect(helpRequest(a), a.join(" ")).to.deep.equal({});
  });
  it("gov help <cmd> → that command", () => {
    expect(helpRequest(["help", "task"])).to.deep.equal({ command: "task" });
  });
  it("--help / -h ANYWHERE after a command → that command's help, never the command", () => {
    expect(helpRequest(["merge", "-h"])).to.deep.equal({ command: "merge" });
    expect(helpRequest(["work", "--help"])).to.deep.equal({ command: "work" });
    expect(helpRequest(["org", "use", "Acme", "--help"])).to.deep.equal({ command: "org" });
  });
  it("after a `--` terminator, -h is a VALUE, not a request", () => {
    expect(helpRequest(["issue", "--title", "x", "--", "-h"])).to.equal(null);
  });
  it("an ordinary command is not help", () => {
    expect(helpRequest(["merge"])).to.equal(null);
    expect(helpRequest([])).to.equal(null);
    expect(helpRequest(["issue", "--title", "help"]), "the WORD help as a value is not the verb").to.equal(null);
  });
});

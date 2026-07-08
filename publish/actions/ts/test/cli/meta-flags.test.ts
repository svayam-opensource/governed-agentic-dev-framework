// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
import { expect } from "chai";
import { readCliVersion, helpLines } from "../../src/cli/main.js";

describe("gov-work — meta flags (--version / --help work without a workspace)", () => {
  it("readCliVersion returns the package version (semver-ish)", () => {
    expect(readCliVersion()).to.match(/^\d+\.\d+\.\d+/);
  });
  it("helpLines() lists the grouped command reference", () => {
    const h = helpLines().join("\n");
    expect(h).to.match(/command reference/);
    expect(h).to.match(/Lifecycle\s+seed/);
    expect(h).to.match(/Governance\s+manage/);
    expect(h).to.match(/seed · join · task/);
  });
  it("helpLines(command) gives per-command guidance", () => {
    expect(helpLines("seed").join("\n")).to.match(/gov-work seed --help/);
  });
});

// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
import { expect } from "chai";
import { resolveMenuChoice, formatMenu, MENU_COMMANDS } from "../../src/cli/menu.js";

describe("prj-work — interactive menu", () => {
  it("resolves a number to the nth command", () => {
    expect(resolveMenuChoice("1")).to.equal(MENU_COMMANDS[0]);
    expect(resolveMenuChoice("3")).to.equal(MENU_COMMANDS[2]);
    expect(resolveMenuChoice(String(MENU_COMMANDS.length))).to.equal(MENU_COMMANDS[MENU_COMMANDS.length - 1]);
  });
  it("resolves a command name typed directly", () => {
    expect(resolveMenuChoice("manage")).to.equal("manage");
    expect(resolveMenuChoice("  knowledge  ")).to.equal("knowledge");
  });
  it("returns null for out-of-range / unknown", () => {
    expect(resolveMenuChoice("0")).to.equal(null);
    expect(resolveMenuChoice("999")).to.equal(null);
    expect(resolveMenuChoice("frobnicate")).to.equal(null);
  });
  it("renders a numbered menu with a quit row", () => {
    const m = formatMenu();
    expect(m[0]).to.match(/pick a command/);
    expect(m).to.include("   0) quit");
    expect(m.some((l) => /manage/.test(l))).to.equal(true);
  });
});

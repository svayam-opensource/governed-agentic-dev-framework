// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * Reading a key with the echo off (#200). The behaviour worth pinning is not the reading — it is
 * that the terminal is handed back in the state it was found in, on every path.
 */
import { expect } from "chai";
import { readSecret, type SecretIo } from "../../src/cli/secret-prompt.js";

function io(line: string | (() => string)): { io: SecretIo; echo: boolean[]; out: string[] } {
  const echo: boolean[] = []; const out: string[] = [];
  return {
    echo, out,
    io: {
      write: (s) => out.push(s),
      setEcho: (on) => echo.push(on),
      readLine: typeof line === "function" ? line : () => line,
    },
  };
}

describe("gov-work — reading an API key (#200)", () => {
  it("asks, turns the echo off, reads, turns it back on", () => {
    const w = io("  sk-abc123  ");
    expect(readSecret("  Paste it: ", w.io)).to.equal("sk-abc123");
    expect(w.echo, "off before the read, on after").to.deep.equal([false, true]);
    expect(w.out[0]).to.equal("  Paste it: ");
    expect(w.out[1], "the typed newline never appeared, so we write one").to.equal("\n");
  });

  it("restores the echo even when the read throws — a terminal with no echo outlives gov", () => {
    const w = io(() => { throw new Error("stdin closed"); });
    expect(() => readSecret("  Paste it: ", w.io)).to.throw("stdin closed");
    expect(w.echo).to.deep.equal([false, true]);
  });

  it("Enter is a real answer, not an error", () => {
    const w = io("");
    expect(readSecret("  Paste it: ", w.io)).to.equal("");
    expect(w.echo).to.deep.equal([false, true]);
  });
});

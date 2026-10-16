// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
//
// ONE VOCABULARY ON EVERY DOOR (#204, ruling Q9 B). install.sh and gov speak in named phases, `→` for
// under way, `✓` for now true, `·` for already present and `!` for a warning — with colour that steps aside
// for NO_COLOR, TERM=dumb and output that is not a terminal. install.ps1 still printed `==>` and `[ok]`, so
// the machine path (CI, Server Core) read like a different product.
//
// Static analysis of the two scripts: the marks are read from each script's own helper definitions and
// compared, so a mark changed on one side and not the other fails here rather than on a Windows runner.
import { expect } from "chai";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../../../../", import.meta.url));
const sh = readFileSync(`${root}install.sh`, "utf8");
const ps1 = readFileSync(`${root}install.ps1`, "utf8");

// install.sh: `info() { printf '  %s→%s %s\n' …` — the character between the colour codes is the mark.
function shMark(fn: string): string {
  const m = new RegExp(`^${fn}\\(\\)\\s*\\{\\s*printf '  %s(.)%s`, "mu").exec(sh);
  if (!m) throw new Error(`install.sh has no ${fn}() helper in the expected shape`);
  return m[1];
}

// install.ps1: the marks are built from code points (`[char]0x2192`) so the script stays ASCII — see below.
function ps1Marks(): Record<string, string> {
  const block = /\$Mark\s*=\s*@\{([^}]*)\}/.exec(ps1);
  if (!block) return {};
  const out: Record<string, string> = {};
  for (const m of block[1].matchAll(/(\w+)\s*=\s*(?:\[char\]0x([0-9A-Fa-f]+)|'([^']*)')/g)) {
    out[m[1]] = m[2] ? String.fromCodePoint(parseInt(m[2], 16)) : m[3];
  }
  return out;
}

// The body of a PowerShell `function Name (...) { ... }` written on one line.
function ps1Fn(name: string): string {
  const m = new RegExp(`^function ${name}\\b.*$`, "m").exec(ps1);
  return m ? m[0] : "";
}

describe("install output vocabulary: install.sh and install.ps1 use the same marks (#204, Q9 B)", () => {
  it("install.ps1 prints none of the old marks — no `[ok]`, `[--]`, `[!]` or `==>`", () => {
    expect(ps1).not.to.include("[ok]");
    expect(ps1).not.to.include("[--]");
    expect(ps1).not.to.match(/"\s*\[!\]/);
    // `===>` is the numbered plan-step banner gov and install.sh share; the bare `==>` is the retired phase mark.
    expect(ps1).not.to.match(/(^|[^=])==>/m);
  });

  it("each helper's mark is the one install.sh uses", () => {
    const marks = ps1Marks();
    const pairs: Array<[string, string]> = [["Info", "info"], ["Ok", "ok"], ["Skip", "skip"], ["Warn", "warn"]];
    for (const [ps, bash] of pairs) {
      expect(marks[ps], `install.ps1 $Mark.${ps}`).to.equal(shMark(bash));
      expect(ps1Fn(ps), `install.ps1 function ${ps} prints $Mark.${ps}`).to.include(`$Mark.${ps}`);
    }
    expect(shMark("info")).to.equal("→");
    expect(shMark("ok")).to.equal("✓");
  });

  it("already present reads the same on both", () => {
    expect(sh).to.include("(already present)");
    expect(ps1Fn("Skip")).to.include("(already present)");
  });

  it("a phase is a NAME set off by blank lines, with no prefix mark", () => {
    const step = ps1Fn("Step");
    expect(step, "function Step").to.include("`n");
    expect(step).not.to.match(/==>|\[|\]\s*\$m/);
    for (const phase of ["Checking what you already have", "Installing Node", "Installing the governance client", "gov doctor"]) {
      expect(sh, `install.sh phase ${phase}`).to.include(`step "${phase}`);
      expect(ps1, `install.ps1 phase ${phase}`).to.include(`Step "${phase}`);
    }
  });

  it("colour steps aside for NO_COLOR, TERM=dumb and output that is not a terminal", () => {
    expect(ps1).to.match(/\$env:NO_COLOR/);
    expect(ps1).to.match(/\$env:TERM\s+-(ne|eq)\s+'dumb'/);
    expect(ps1).to.match(/\[Console\]::IsOutputRedirected/);
  });

  // `irm … | iex` on Windows PowerShell 5.1 decodes a response with no charset as ISO-8859-1, and a saved .ps1
  // with no BOM as the ANSI code page. A literal `→` in the script arrives as `â†’`. ASCII source with the marks
  // built from code points is the one shape that reads the same everywhere.
  it("install.ps1 is ASCII, so PowerShell 5.1 reads it the same however it was fetched", () => {
    const nonAscii = [...ps1].filter((c) => c.codePointAt(0)! > 0x7e && c !== "\n");
    expect(nonAscii.join(""), "non-ASCII characters in install.ps1").to.equal("");
  });
});

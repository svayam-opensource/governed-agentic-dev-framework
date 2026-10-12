// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * SPAWNING ON WINDOWS (#223, PRJ-121 plan 04 T10, ruling Q10 B).
 *
 * Node's `spawnSync(cmd, args)` with no shell resolves only `.exe` files on win32 — `npm`, `code`, `claude` are
 * `.cmd` shims, so every agent install died with ENOENT on Windows and no test noticed: none ran the executor
 * under win32. The fix is one chokepoint: resolve `cmd` through PATH × PATHEXT, spawn a `.exe` directly, run a
 * `.cmd`/`.bat` through `cmd.exe /d /s /c` with each argument escaped. These tests drive that plan as a pure
 * function with an injected platform, environment and file system, so they run on any OS; the real proof is the
 * `adopter-e2e / windows` job (T16).
 */
import { expect } from "chai";
import { CommandNotFoundError, escapeCmdArg, resolveWin32Command, spawnPlan } from "../src/win-spawn.js";

const files = (...paths: string[]) => {
  const set = new Set(paths.map((p) => p.toLowerCase()));
  return (p: string) => set.has(p.toLowerCase());
};
const ENV = { Path: "C:\\Users\\a\\AppData\\Local\\Programs\\gov\\bin;C:\\Program Files\\nodejs;C:\\Windows\\System32", PATHEXT: ".COM;.EXE;.BAT;.CMD", ComSpec: "C:\\Windows\\System32\\cmd.exe" };

describe("win-spawn — resolving a command on Windows (PATH × PATHEXT)", () => {
  it("finds a .cmd shim that a bare spawn would miss", () => {
    const r = resolveWin32Command("npm", { env: ENV, isFile: files("C:\\Program Files\\nodejs\\npm.cmd") });
    expect(r.path).to.equal("C:\\Program Files\\nodejs\\npm.cmd");
  });

  it("walks PATH in order, and PATHEXT in order within each directory", () => {
    const r = resolveWin32Command("gov", {
      env: ENV,
      isFile: files("C:\\Users\\a\\AppData\\Local\\Programs\\gov\\bin\\gov.cmd", "C:\\Program Files\\nodejs\\gov.exe"),
    });
    expect(r.path, "the first PATH directory wins").to.equal("C:\\Users\\a\\AppData\\Local\\Programs\\gov\\bin\\gov.cmd");
    const r2 = resolveWin32Command("tool", { env: ENV, isFile: files("C:\\Windows\\System32\\tool.exe", "C:\\Windows\\System32\\tool.cmd") });
    expect(r2.path, ".EXE comes before .CMD in PATHEXT").to.equal("C:\\Windows\\System32\\tool.exe");
  });

  it("reads PATH whatever its case — Windows spells it Path", () => {
    const r = resolveWin32Command("git", { env: { PATH: "C:\\Git\\cmd" }, isFile: files("C:\\Git\\cmd\\git.exe") });
    expect(r.path).to.equal("C:\\Git\\cmd\\git.exe");
  });

  it("uses the default PATHEXT when none is set", () => {
    const r = resolveWin32Command("code", { env: { Path: "C:\\VS\\bin" }, isFile: files("C:\\VS\\bin\\code.cmd") });
    expect(r.path).to.equal("C:\\VS\\bin\\code.cmd");
  });

  it("takes a name that already has an extension as it is", () => {
    const r = resolveWin32Command("npm.cmd", { env: ENV, isFile: files("C:\\Program Files\\nodejs\\npm.cmd") });
    expect(r.path).to.equal("C:\\Program Files\\nodejs\\npm.cmd");
  });

  it("checks a path with a directory directly, without searching PATH", () => {
    const r = resolveWin32Command("C:\\tools\\agent", { env: ENV, isFile: files("C:\\tools\\agent.cmd") });
    expect(r.path).to.equal("C:\\tools\\agent.cmd");
  });

  it("reports every directory it searched when nothing is found", () => {
    const r = resolveWin32Command("claude", { env: ENV, isFile: () => false });
    expect(r.path).to.equal(undefined);
    expect(r.searched).to.deep.equal(ENV.Path.split(";"));
  });
});

describe("win-spawn — escaping an argument for cmd.exe", () => {
  it("quotes every argument, so a space never splits one", () => {
    expect(escapeCmdArg("hello world", false)).to.equal('^"hello^ world^"');
  });

  it("escapes a double quote as \\\" inside the quotes", () => {
    expect(escapeCmdArg('say "hi"', false)).to.equal('^"say^ \\^"hi\\^"^"');
  });

  it("caret-escapes the metacharacters cmd would act on: & | < > ^ % !", () => {
    const e = escapeCmdArg("a&b|c<d>e^f%PATH%!x!", false);
    for (const m of ["^&", "^|", "^<", "^>", "^^", "^%", "^!"]) expect(e, m).to.contain(m);
    expect(e).to.not.match(/[^^][&|<>]/);
  });

  it("doubles backslashes that precede a quote or the end, so the closing quote survives", () => {
    expect(escapeCmdArg("C:\\dir\\", false)).to.equal('^"C:\\dir\\\\^"');
    expect(escapeCmdArg('a\\"b', false)).to.equal('^"a\\\\\\^"b^"');
  });

  it("escapes twice for an npm .cmd shim, which re-parses its arguments through cmd once more", () => {
    expect(escapeCmdArg("a&b", true)).to.equal('^^^"a^^^&b^^^"');
  });

  it("leaves an empty argument as an empty quoted argument", () => {
    expect(escapeCmdArg("", false)).to.equal('^"^"');
  });
});

describe("win-spawn — the spawn plan", () => {
  const isFile = files("C:\\Program Files\\nodejs\\npm.cmd", "C:\\Program Files\\nodejs\\node.exe", "C:\\Users\\a\\AppData\\Local\\Programs\\gov\\bin\\node_modules\\.bin\\x.cmd");

  it("is the command itself on every other platform — nothing changes off Windows", () => {
    for (const platform of ["linux", "darwin"] as const) {
      expect(spawnPlan("npm", ["i", "-g", "x"], { platform, env: ENV, isFile })).to.deep.equal({ file: "npm", args: ["i", "-g", "x"], verbatim: false });
    }
  });

  it("spawns a resolved .exe directly, by its full path", () => {
    const p = spawnPlan("node", ["--version"], { platform: "win32", env: ENV, isFile });
    expect(p).to.deep.equal({ file: "C:\\Program Files\\nodejs\\node.exe", args: ["--version"], verbatim: false });
  });

  it("runs a resolved .cmd through cmd.exe /d /s /c, verbatim, with every part escaped", () => {
    const p = spawnPlan("npm", ["install", "-g", "@anthropic-ai/claude-code"], { platform: "win32", env: ENV, isFile });
    expect(p.file).to.equal("C:\\Windows\\System32\\cmd.exe");
    expect(p.verbatim, "Node must not re-quote what we quoted").to.equal(true);
    expect(p.args.slice(0, 3)).to.deep.equal(["/d", "/s", "/c"]);
    expect(p.args[3]).to.equal('"C:\\Program^ Files\\nodejs\\npm.cmd ^"install^" ^"-g^" ^"@anthropic-ai/claude-code^""');
  });

  it("falls back to cmd.exe when ComSpec is unset", () => {
    const p = spawnPlan("npm", [], { platform: "win32", env: { Path: "C:\\Program Files\\nodejs" }, isFile });
    expect(p.file).to.equal("cmd.exe");
  });

  it("double-escapes the arguments of a node_modules\\.bin shim, as cross-spawn does", () => {
    const p = spawnPlan("x", ["a&b"], { platform: "win32", env: { Path: "C:\\Users\\a\\AppData\\Local\\Programs\\gov\\bin\\node_modules\\.bin" }, isFile });
    expect(p.args[3]).to.contain('^^^"a^^^&b^^^"');
  });

  it("not found → an error naming the command and the PATH searched, not a bare ENOENT", () => {
    let err: unknown;
    try { spawnPlan("claude", ["--version"], { platform: "win32", env: ENV, isFile: () => false }); } catch (e) { err = e; }
    expect(err).to.be.instanceOf(CommandNotFoundError);
    const e = err as CommandNotFoundError;
    expect(e.code, "callers that test for ENOENT still work").to.equal("ENOENT");
    expect(e.message).to.contain("claude");
    expect(e.message).to.contain("C:\\Program Files\\nodejs");
    expect(e.message).to.contain(".CMD");
  });
});

// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * THE OTHER WINDOWS HAZARDS (PRJ-121 plan 04 T11, spec §4.1 table, §4.4).
 *
 * #223 was the spawn chokepoint (T10). The same read of the code found four more places that assume a POSIX
 * machine: the shell gov opens when `$SHELL` is unset, the terminal device a synchronous question reads, the
 * shortcut that keeps an installed agent reachable after gov exits (#209), and the credentials file's privacy.
 * Plus the update notice, which on Windows must name winget and never `npm i -g` (Q11). Each is a pure function
 * with the platform injected, so these run on any OS; the real proof is the `adopter-e2e / windows` job (T16).
 */
import { expect } from "chai";
import { fallbackShell } from "../../src/cli/work-flow.js";
import {
  clientUpdateCommand, ownerOnlyAclArgv, ttyDevice, windowsAgentShim, windowsLinkPlan,
} from "../../src/cli/windows.js";
import { checkVersionCompat } from "../../src/maintain/version-compat.js";
import { upgradePlan } from "../../src/maintain/upgrade.js";

const files = (...paths: string[]) => {
  const set = new Set(paths.map((p) => p.toLowerCase()));
  return (p: string) => set.has(p.toLowerCase());
};

describe("windows hazards — the shell gov opens when $SHELL is unset", () => {
  it("is unchanged off Windows: bash, else sh", () => {
    expect(fallbackShell(files("/bin/bash"), "linux", {})).to.equal("/bin/bash");
    expect(fallbackShell(() => false, "darwin", {})).to.equal("/bin/sh");
  });

  it("prefers pwsh on Windows when it is on PATH", () => {
    const env = { Path: "C:\\Program Files\\PowerShell\\7;C:\\Windows\\System32", ComSpec: "C:\\Windows\\System32\\cmd.exe" };
    expect(fallbackShell(files("C:\\Program Files\\PowerShell\\7\\pwsh.exe"), "win32", env)).to.equal("C:\\Program Files\\PowerShell\\7\\pwsh.exe");
  });

  it("falls back to %ComSpec% on Windows — never /bin/bash", () => {
    const env = { Path: "C:\\Windows\\System32", ComSpec: "C:\\Windows\\System32\\cmd.exe" };
    expect(fallbackShell(() => false, "win32", env)).to.equal("C:\\Windows\\System32\\cmd.exe");
    expect(fallbackShell(() => false, "win32", {})).to.equal("cmd.exe");
  });
});

describe("windows hazards — the terminal a synchronous question reads", () => {
  it("is /dev/tty off Windows and the console input device on Windows", () => {
    expect(ttyDevice("linux")).to.equal("/dev/tty");
    expect(ttyDevice("darwin")).to.equal("/dev/tty");
    expect(ttyDevice("win32")).to.equal("\\\\.\\CONIN$");
  });
});

describe("windows hazards — an installed agent stays reachable (#209 on Windows)", () => {
  const nodeBin = "C:\\Users\\a\\AppData\\Local\\Programs\\gov\\node";
  const binDir = "C:\\Users\\a\\AppData\\Local\\Programs\\gov\\bin";

  it("writes <agent>.cmd into gov's own bin directory (GOV_BIN_DIR, set by the launcher)", () => {
    const p = windowsLinkPlan({ cmd: "claude", nodeBin, env: { GOV_BIN_DIR: binDir, Path: `${binDir};C:\\Windows` }, isFile: files(`${nodeBin}\\claude.cmd`) });
    expect(p.kind).to.equal("write");
    if (p.kind !== "write") return;
    expect(p.shim).to.equal(`${binDir}\\claude.cmd`);
    expect(p.target).to.equal(`${nodeBin}\\claude.cmd`);
  });

  it("writes the shim under the MSI launcher, which itself put gov's Node first on gov's own PATH (found in T16)", () => {
    // bin\gov.cmd prepends node\ for gov's process only. That entry is the LAUNCHER's, not the adopter's shell's —
    // the same trap #209 fell into with install.sh — so it is no evidence the agent is reachable after gov exits.
    const p = windowsLinkPlan({ cmd: "claude", nodeBin, env: { GOV_BIN_DIR: binDir, Path: `${nodeBin};${binDir};C:\\Windows` }, isFile: files(`${nodeBin}\\claude.cmd`) });
    expect(p.kind).to.equal("write");
  });

  it("the shim puts gov's private Node first for its own process only, and passes every argument", () => {
    const text = windowsAgentShim(nodeBin, `${nodeBin}\\claude.cmd`);
    expect(text).to.match(/^@echo off\r\n/);
    expect(text).to.contain("setlocal");
    expect(text).to.contain(`set "PATH=${nodeBin};%PATH%"`);
    expect(text).to.contain(`call "${nodeBin}\\claude.cmd" %*`);
    expect(text, "CRLF throughout — cmd.exe misparses LF-only batch files").to.not.match(/[^\r]\n/);
  });

  it("is not ours when the agent is not beside gov's Node", () => {
    expect(windowsLinkPlan({ cmd: "claude", nodeBin, env: { GOV_BIN_DIR: binDir }, isFile: () => false }).kind).to.equal("not-ours");
  });

  it("is not needed when gov's Node directory is itself on PATH (a machine Node, gov installed by npm)", () => {
    const p = windowsLinkPlan({ cmd: "claude", nodeBin, env: { Path: `${nodeBin};C:\\Windows` }, isFile: files(`${nodeBin}\\claude.cmd`) });
    expect(p.kind).to.equal("not-ours");
  });

  it("says there is nowhere to link when gov's bin directory is unknown or not on PATH", () => {
    const p = windowsLinkPlan({ cmd: "claude", nodeBin, env: { Path: "C:\\Windows" }, isFile: files(`${nodeBin}\\claude.cmd`) });
    expect(p.kind).to.equal("nowhere-to-link");
    const p2 = windowsLinkPlan({ cmd: "claude", nodeBin, env: { GOV_BIN_DIR: binDir, Path: "C:\\Windows" }, isFile: files(`${nodeBin}\\claude.cmd`) });
    expect(p2.kind).to.equal("nowhere-to-link");
    if (p2.kind === "nowhere-to-link") expect(p2.dir).to.equal(binDir);
  });
});

describe("windows hazards — the credentials file is owner-only", () => {
  it("builds an icacls command that drops inherited access and grants only the user", () => {
    expect(ownerOnlyAclArgv("C:\\Users\\a\\.gov\\preferences\\a\\credentials", { USERNAME: "a", USERDOMAIN: "PC" })).to.deep.equal(
      ["icacls", "C:\\Users\\a\\.gov\\preferences\\a\\credentials", "/inheritance:r", "/grant:r", "PC\\a:(F)"]);
  });

  it("uses the bare user name when there is no domain, and nothing when the user is unknown", () => {
    expect(ownerOnlyAclArgv("f", { USERNAME: "a" })?.[4]).to.equal("a:(F)");
    expect(ownerOnlyAclArgv("f", {})).to.equal(null);
  });
});

describe("windows hazards — the update notice names winget on Windows (Q11)", () => {
  it("the client update command per platform", () => {
    expect(clientUpdateCommand("2.0.1", "win32")).to.equal("winget upgrade Svayam.Gov");
    expect(clientUpdateCommand("2.0.1", "linux")).to.equal("npm install -g @svayam-opensource/gov@2.0.1");
  });

  it("`gov upgrade` prints winget on Windows, never npm", () => {
    const p = upgradePlan("2.0.0", "2.0.1", "win32");
    expect(p.kind).to.equal("install");
    if (p.kind === "install") expect(p.command).to.equal("winget upgrade Svayam.Gov");
  });

  it("the 'CLI is behind the content' notice prints winget on Windows, never npm i -g", () => {
    for (const [cli, content] of [["1.2.0", "1.3.0"], ["1.2.0", "2.0.0"]] as const) {
      const m = checkVersionCompat(cli, content, "win32").message ?? "";
      expect(m).to.contain("winget upgrade Svayam.Gov");
      expect(m).to.not.contain("npm i");
    }
    expect(checkVersionCompat("1.2.0", "1.3.0", "linux").message).to.contain("npm i -g @svayam-opensource/gov@1.3.0");
  });
});

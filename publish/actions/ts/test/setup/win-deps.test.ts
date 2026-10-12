// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * GIT AND GH ON WINDOWS, ON CONSENT (PRJ-121 plan 04 T12, ruling Q6 B, spec §4.2).
 *
 * The MSI carries Node and gov, not git or gh. First-run steps 3–4 install them with winget, PER-USER (no
 * administrator — bank desktops often deny it, Q5), after the one consent gate every other fix goes through.
 * When a package offers no per-user installer, winget refuses with NO_APPLICABLE_INSTALLER; gov then prints the
 * machine-wide command for an administrator terminal and does NOT tick the step. A winget install updates the
 * user PATH in the registry, not gov's own process, so gov re-reads it before checking the tool is there.
 */
import { expect } from "chai";
import {
  formatPlanNarrative, planFixes, renderCommand, wingetFailureLines, mergeWindowsPath, parseRegQueryPath, WINGET_NO_APPLICABLE_INSTALLER,
} from "../../src/maintain/fix-env.js";

const WIN = { gitPresent: false, ghPresent: false, ghAuthenticated: false, platform: "win32" } as const;

describe("win-deps — git and gh through winget, per-user, on consent", () => {
  it("consent → the exact per-user winget argv for each", () => {
    const plan = planFixes(WIN, "winget");
    const git = plan.steps.find((s) => s.fixes === "git")!;
    const gh = plan.steps.find((s) => s.fixes === "gh")!;
    expect(git.command).to.deep.equal(["winget", "install", "--id", "Git.Git", "-e", "--scope", "user"]);
    expect(gh.command).to.deep.equal(["winget", "install", "--id", "GitHub.cli", "-e", "--scope", "user"]);
    expect(git.sudo || gh.sudo, "never elevated").to.equal(false);
  });

  it("decline → the commands were already printed, exactly as they would run", () => {
    const plan = planFixes(WIN, "winget");
    const text = formatPlanNarrative(plan).join("\n");
    expect(text).to.contain("winget install --id Git.Git -e --scope user");
    expect(text).to.contain("winget install --id GitHub.cli -e --scope user");
    expect(renderCommand(plan.steps.find((s) => s.fixes === "gh")!)).to.equal("winget install --id GitHub.cli -e --scope user");
  });

  it("no per-user installer → the machine-wide command is printed for an administrator, and the step is not ticked", () => {
    const gh = planFixes(WIN, "winget").steps.find((s) => s.fixes === "gh")!;
    for (const status of [WINGET_NO_APPLICABLE_INSTALLER, WINGET_NO_APPLICABLE_INSTALLER - 2 ** 32]) {
      const r = wingetFailureLines(gh, status);
      expect(r, `status ${status}`).to.not.equal(null);
      expect(r!.join("\n")).to.contain("winget install --id GitHub.cli -e");
      expect(r!.join("\n")).to.not.contain("--scope user");
      expect(r!.join("\n")).to.contain("administrator");
    }
  });

  it("any other failure, or a non-winget step, is left to the ordinary failure line", () => {
    const gh = planFixes(WIN, "winget").steps.find((s) => s.fixes === "gh")!;
    expect(wingetFailureLines(gh, 1)).to.equal(null);
    const apt = planFixes({ ...WIN, platform: "linux" }, "apt").steps.find((s) => s.fixes === "gh")!;
    expect(wingetFailureLines(apt, WINGET_NO_APPLICABLE_INSTALLER)).to.equal(null);
  });
});

describe("win-deps — gov sees what winget just installed", () => {
  const reg = [
    "",
    "HKEY_CURRENT_USER\\Environment",
    "    Path    REG_EXPAND_SZ    %USERPROFILE%\\AppData\\Local\\Programs\\gov\\bin;C:\\Users\\a\\AppData\\Local\\Programs\\Git\\cmd",
    "",
  ].join("\r\n");

  it("parses the Path value out of `reg query`", () => {
    expect(parseRegQueryPath(reg)).to.equal("%USERPROFILE%\\AppData\\Local\\Programs\\gov\\bin;C:\\Users\\a\\AppData\\Local\\Programs\\Git\\cmd");
    expect(parseRegQueryPath("ERROR: The system was unable to find the specified registry key or value.")).to.equal(null);
  });

  it("appends only the new directories to the process PATH, expanding %VARS%, without reordering", () => {
    const merged = mergeWindowsPath("C:\\Windows;C:\\Users\\a\\AppData\\Local\\Programs\\gov\\bin", parseRegQueryPath(reg)!, { USERPROFILE: "C:\\Users\\a" });
    expect(merged).to.equal("C:\\Windows;C:\\Users\\a\\AppData\\Local\\Programs\\gov\\bin;C:\\Users\\a\\AppData\\Local\\Programs\\Git\\cmd");
  });
});

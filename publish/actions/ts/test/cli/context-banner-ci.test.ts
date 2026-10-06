// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * The banner is for a person at a terminal. Sandbox finding (PRJ-121, 2026-10-07): it printed
 * "gov · context: NONE … no organization set up on this machine yet" in every GitHub Actions log.
 */
import { expect } from "chai";
import { shouldShowBanner } from "../../src/cli/context-banner.js";

describe("context banner — when it prints", () => {
  it("prints for a person at a terminal", () => {
    expect(shouldShowBanner({}, true)).to.equal(true);
  });
  it("never prints in GitHub Actions, even if the runner fakes a terminal", () => {
    expect(shouldShowBanner({ GITHUB_ACTIONS: "true" }, true)).to.equal(false);
    expect(shouldShowBanner({ GITHUB_ACTIONS: "true" }, false)).to.equal(false);
  });
  it("does not print when stdout is not a terminal (piped, redirected, another CI)", () => {
    expect(shouldShowBanner({}, false)).to.equal(false);
  });
  it("GOV_NO_BANNER still turns it off at a terminal", () => {
    expect(shouldShowBanner({ GOV_NO_BANNER: "" }, true)).to.equal(false);
  });
  it("GITHUB_ACTIONS set to something other than true does not count as Actions", () => {
    expect(shouldShowBanner({ GITHUB_ACTIONS: "false" }, true)).to.equal(true);
  });
});

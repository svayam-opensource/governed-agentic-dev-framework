// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * Routing gov-cicd verbs to the plugin.
 *
 * `OPERATE_COMMANDS` used to BE the authority, which made every new governed verb a two-place edit — the
 * plugin's command list and this set — with nothing checking they agreed. `gov version bump` was registered
 * in one and not the other, so the host answered "unknown command" for a verb that existed and worked.
 *
 * gov-infra never had this problem: its verbs are discovered. gov-cicd's MENU was discovered too; only its
 * ROUTING was static. These cases pin the fix so the static seed cannot quietly become the authority again.
 */
import { expect } from "chai";
import { isGovernedInvocation, OPERATE_COMMANDS } from "../../src/cli/host.js";
import { helpCommandNames } from "../../src/cli/main.js";

describe("operate routing — the seed is a fast path, not the authority", () => {
  it("routes a seeded operate verb without consulting the plugin", () => {
    expect(isGovernedInvocation(["deploy", "portal-api", "--env", "dev"], helpCommandNames())).to.equal(true);
    expect(isGovernedInvocation(["promote", "gov-work", "--to", "prod"], helpCommandNames())).to.equal(true);
  });

  // The host's own verbs must never be delegated — and must not cost a subprocess to decide.
  it("keeps the host's own commands", () => {
    for (const c of ["setup", "doctor", "deps", "upgrade", "publish"]) {
      expect(isGovernedInvocation([c], helpCommandNames()), c).to.equal(false);
    }
  });

  it("looks past leading value-flags to find the verb", () => {
    expect(isGovernedInvocation(["--gov-home", "/tmp/x", "deploy", "u"], helpCommandNames())).to.equal(true);
  });

  it("routes nothing for an empty invocation", () => {
    expect(isGovernedInvocation([], helpCommandNames())).to.equal(false);
  });

  // THE REGRESSION. Every seeded verb must still be a real plugin verb, and — more importantly — the seed
  // must never be treated as the complete set: a verb absent from it is asked of the plugin, not refused.
  // Without this, adding a governed verb silently requires a host release nobody knows to make.
  it("does not refuse a verb merely because the static seed lacks it", () => {
    const unseeded = "some-future-governed-verb";
    expect(OPERATE_COMMANDS.has(unseeded)).to.equal(false);
    expect(helpCommandNames()).to.not.include(unseeded);
    // Falls through to plugin discovery rather than short-circuiting to false. With no plugin installed
    // discovery yields nothing, so the answer is false — but it is false for the RIGHT reason, and the
    // same call answers true the moment the plugin reports the verb.
    expect(isGovernedInvocation([unseeded], helpCommandNames())).to.equal(false);
  });

  // The host's help deliberately ADVERTISES verbs it delegates, so users can discover them — `promote`,
  // `rollback`, `drift`, `data` are in both lists. Appearing in help is therefore not ownership, and the
  // overlap must resolve to the PLUGIN. Getting this backwards would un-route four live verbs.
  it("resolves a verb the host merely ADVERTISES to the plugin, not to the host", () => {
    const advertised = [...OPERATE_COMMANDS].filter((c) => helpCommandNames().includes(c));
    expect(advertised.length, "expected the host help to advertise some delegated verbs").to.be.greaterThan(0);
    for (const c of advertised) expect(isGovernedInvocation([c], helpCommandNames()), c).to.equal(true);
  });
});

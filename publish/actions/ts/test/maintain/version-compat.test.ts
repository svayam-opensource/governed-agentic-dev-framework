// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
import { expect } from "chai";
import { checkVersionCompat } from "../../src/maintain/version-compat.js";

describe("gov-work — CLI ↔ content version compat", () => {
  it("equal → ok", () => expect(checkVersionCompat("1.2.0", "1.2.0")).to.include({ status: "ok", ok: true }));
  it("no marker → ok (guidance)", () => expect(checkVersionCompat("1.2.0", null)).to.include({ status: "no-marker", ok: true }));
  it("content behind CLI → warn, run gov-work upgrade", () => {
    const r = checkVersionCompat("1.3.0", "1.1.0");
    expect(r).to.include({ status: "content-behind", ok: true });
    expect(r.message).to.match(/gov-work upgrade/);
  });
  it("CLI behind (same major) → warn, upgrade CLI (still ok)", () => {
    const r = checkVersionCompat("1.1.0", "1.4.0");
    expect(r).to.include({ status: "cli-behind", ok: true });
    expect(r.message).to.match(/npm i -g @svayam-opensource\/gov-work@1\.4\.0/);
  });
  it("CLI a MAJOR behind → HARD STOP", () => {
    const r = checkVersionCompat("1.9.0", "2.0.0");
    expect(r).to.include({ status: "cli-behind-major", ok: false });
    expect(r.message).to.match(/MAJOR version behind/);
  });
});

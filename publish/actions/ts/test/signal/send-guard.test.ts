// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/** Spec 03 Q6(b) — a person sends: refused inside a gov-launched agent session, and without an interactive confirm. */
import { expect } from "chai";
import { sendGuard, AGENT_SESSION_ENV } from "../../src/signal/model.js";

describe("signal — who may send (Q6)", () => {
  it("refused inside a gov-launched agent session, pointing at the draft path", () => {
    const r = sendGuard({ env: { [AGENT_SESSION_ENV]: "claude-code" }, interactive: true, confirmed: true, project: "PRJ-1" });
    expect(r.ok).to.equal(false);
    if (!r.ok) expect(r.reason).to.match(/agent session/).and.match(/projects\/PRJ-1\/signals\/drafts\//);
  });
  it("refused without an interactive terminal", () => {
    const r = sendGuard({ env: {}, interactive: false, confirmed: false, project: "PRJ-1" });
    expect(r.ok).to.equal(false);
    if (!r.ok) expect(r.reason).to.match(/interactive/);
  });
  it("refused when the person declines the confirm", () => {
    expect(sendGuard({ env: {}, interactive: true, confirmed: false, project: "PRJ-1" }).ok).to.equal(false);
  });
  it("a person at a terminal who confirms may send", () => {
    expect(sendGuard({ env: {}, interactive: true, confirmed: true, project: "PRJ-1" })).to.deep.equal({ ok: true });
  });
});

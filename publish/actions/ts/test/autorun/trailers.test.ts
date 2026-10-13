// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/** Spec 03 §3.4 / plan §7 decision 2 — every autorun commit carries Gov-Autorun and Gov-Agent trailers. */
import { expect } from "chai";
import { withTrailers, readTrailers } from "../../src/autorun/record.js";

describe("autorun — commit trailers", () => {
  it("appends Gov-Autorun and Gov-Agent after a blank line, once", () => {
    const m = withTrailers("spec: draft 03", { runId: "2026-10-13-0800-ab12", agent: "claude-code" });
    expect(m).to.equal("spec: draft 03\n\nGov-Autorun: 2026-10-13-0800-ab12\nGov-Agent: claude-code");
    expect(withTrailers(m, { runId: "2026-10-13-0800-ab12", agent: "claude-code" })).to.equal(m);
  });
  it("joins an existing trailer block (Co-Authored-By) rather than starting a second", () => {
    const m = withTrailers("x\n\nCo-Authored-By: A <a@b>", { runId: "r", agent: "k" });
    expect(m).to.equal("x\n\nCo-Authored-By: A <a@b>\nGov-Autorun: r\nGov-Agent: k");
    expect(readTrailers(m)).to.deep.equal({ runId: "r", agent: "k" });
  });
});

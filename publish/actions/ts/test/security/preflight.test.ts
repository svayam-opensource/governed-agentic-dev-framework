// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
import { expect } from "chai";
import { preflight, renderGap } from "../../src/security/preflight.js";
import { assembleNeeds, gitIdentityNeed, ghAuthNeed, type NeedProbes } from "../../src/security/needs.js";

const probes = (over: Partial<{ git: Record<string, string>; gh: boolean; creds: Set<string> }> = {}): NeedProbes => ({
  gitConfig: (k) => (over.git ?? { "user.name": "R", "user.email": "r@o" })[k],
  ghAuthOk: () => over.gh ?? true,
  hasCred: (k) => over.creds?.has(k) ?? true,
});

describe("security — preflight gate", () => {
  it("ok when every NEED is satisfied (silent no-op)", () => {
    const r = preflight(assembleNeeds(), probes());
    expect(r.ok).to.equal(true);
    expect(r.gap).to.deep.equal([]);
  });

  it("blocks with the unmet NEEDs when something is missing", () => {
    const r = preflight(assembleNeeds(), probes({ gh: false }));
    expect(r.ok).to.equal(false);
    expect(r.gap.map((n) => n.id)).to.deep.equal([ghAuthNeed.id]);
  });

  it("renderGap lists the unmet needs and points at `gov-work creds`", () => {
    const gap = preflight([gitIdentityNeed, ghAuthNeed], probes({ git: {}, gh: false })).gap;
    const lines = renderGap(gap).join("\n");
    expect(lines).to.match(/2 unmet security NEED/);
    expect(lines).to.match(/git commit identity/);
    expect(lines).to.match(/gov-work creds/);
  });
});

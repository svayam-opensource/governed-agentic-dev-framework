// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/** Spec 03 §4 — one signal = one issue in the gov repo, label `gov-signal:<kind>`, with a machine-readable marker. */
import { expect } from "chai";
import { renderMarker, parseMarker, signalLabel, SIGNAL_KINDS, findSignals } from "../../src/signal/marker.js";
import type { SignalMarker } from "../../src/signal/model.js";

const m: SignalMarker = { kind: "depends", from: "PRJ-121-doc-update-issue-116", to: "PRJ-119-gov-iam", items: ["Svayamtech/svm-prj-work#434"] };

describe("signal — marker", () => {
  it("round-trips through an issue body, wherever it sits", () => {
    const body = `Some prose.\n\n${renderMarker(m)}\n\nMore prose.`;
    expect(parseMarker(body)).to.deep.equal(m);
  });

  it("renders the exact comment form the spec names", () => {
    expect(renderMarker(m)).to.match(/^<!-- gov-signal \{"kind":"depends","from":"PRJ-121-doc-update-issue-116","to":"PRJ-119-gov-iam","items":\["Svayamtech\/svm-prj-work#434"\]\} -->$/);
  });

  it("no marker, a broken one, or an unknown kind → null (never a guess)", () => {
    expect(parseMarker("plain issue")).to.equal(null);
    expect(parseMarker("<!-- gov-signal {not json} -->")).to.equal(null);
    expect(parseMarker('<!-- gov-signal {"kind":"shout","from":"A","to":"B","items":[]} -->')).to.equal(null);
    expect(parseMarker('<!-- gov-signal {"kind":"ask","from":"A"} -->')).to.equal(null);
  });

  it("five kinds, one label each", () => {
    expect([...SIGNAL_KINDS]).to.deep.equal(["ask", "depends", "handover", "merge", "notice"]);
    expect(signalLabel("notice")).to.equal("gov-signal:notice");
  });

  it("findSignals sorts open signals into incoming and outgoing for a project, by marker alone (Q5)", () => {
    const issues = [
      { url: "u1", title: "a", body: renderMarker({ kind: "ask", from: "PRJ-2", to: "PRJ-1", items: [] }), open: true },
      { url: "u2", title: "b", body: renderMarker({ kind: "notice", from: "PRJ-1", to: "PRJ-3", items: [] }), open: true },
      { url: "u3", title: "c", body: renderMarker({ kind: "ask", from: "PRJ-2", to: "PRJ-1", items: [] }), open: false },
      { url: "u4", title: "d", body: "no marker", open: true },
    ];
    const r = findSignals(issues, "PRJ-1");
    expect(r.incoming.map((s) => s.url)).to.deep.equal(["u1"]);
    expect(r.outgoing.map((s) => s.url)).to.deep.equal(["u2"]);
  });
});

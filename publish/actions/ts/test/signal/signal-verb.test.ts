// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/** `gov signal` the verb — Q6 enforced where a person meets it; a draft an agent wrote is sent by a person. */
import { expect } from "chai";
import { createMemoryWorkTracker } from "../../src/adapters/memory/work-tracker.js";
import { signalCommand, type SignalVerbDeps } from "../../src/cli/signal-verb.js";
import { AGENT_SESSION_ENV } from "../../src/signal/model.js";

const deps = (over: Partial<SignalVerbDeps> = {}): SignalVerbDeps & { asked: string[] } => {
  const asked: string[] = [];
  return {
    tracker: createMemoryWorkTracker({ projects: [{ ref: { owner: "acme", number: 1 }, title: "a" }, { ref: { owner: "acme", number: 2 }, title: "b" }] }),
    govRepo: { owner: "acme", name: "gov" }, owner: "acme", login: "ann", project: "PRJ-1-alpha",
    env: {}, interactive: true, confirm: async (q) => { asked.push(q); return true; }, readFile: () => null, asked, ...over,
  };
};

describe("gov signal — the verb", () => {
  it("a person at a terminal sends after confirming", async () => {
    const d = deps();
    const r = await signalCommand(["ask"], { to: "PRJ-2-beta", title: "need X" }, d);
    expect(r.code, r.lines.join("\n")).to.equal(0);
    expect(d.asked[0]).to.match(/Send ask "need X" from PRJ-1-alpha to PRJ-2-beta\?/);
  });

  it("inside a gov-launched agent session: refused before anything is asked or written", async () => {
    const d = deps({ env: { [AGENT_SESSION_ENV]: "claude-code" } });
    const r = await signalCommand(["notice"], { to: "PRJ-2-beta", title: "fyi" }, d);
    expect(r.code).to.equal(1);
    expect(r.lines.join()).to.match(/signals\/drafts/);
    expect(d.asked).to.deep.equal([]);
    const s = await d.tracker.search({ marker: "gov-signal" });
    expect(s.ok && s.value).to.deep.equal([]);
  });

  it("without a terminal: refused", async () => {
    const r = await signalCommand(["ask"], { to: "PRJ-2-beta", title: "t" }, deps({ interactive: false }));
    expect(r.code).to.equal(1);
  });

  it("declined: nothing sent", async () => {
    const d = deps({ confirm: async () => false });
    expect((await signalCommand(["ask"], { to: "PRJ-2-beta", title: "t" }, d)).code).to.equal(1);
    const s = await d.tracker.search({ marker: "gov-signal" });
    expect(s.ok && s.value).to.deep.equal([]);
  });

  it("send <draft>: a person sends what an agent drafted", async () => {
    const draft = "---\nkind: notice\nto: PRJ-2-beta\ntitle: heads up\n---\nThe API moves.\n";
    const d = deps({ readFile: (f) => (f.endsWith("drafts/x.md") ? draft : null) });
    const r = await signalCommand(["send", "projects/PRJ-1-alpha/signals/drafts/x.md"], {}, d);
    expect(r.code, r.lines.join("\n")).to.equal(0);
    expect(r.lines[0]).to.match(/Sent notice → PRJ-2-beta/);
  });

  it("handover/merge say they are not in this build; outside a project it says so", async () => {
    expect((await signalCommand(["handover"], { to: "PRJ-2-b", title: "t" }, deps())).lines.join()).to.match(/L08/);
    expect((await signalCommand(["list"], {}, deps({ project: null }))).code).to.equal(1);
  });
});

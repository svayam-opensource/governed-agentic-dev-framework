// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * THE ADAPTER REGISTRY (PRJ-121 intent 03, D7/Q15). Core code asks for a port by name; which adapter answers is a
 * deployment fact read from org-config.yaml's `adapters:` block, `github` when it says nothing. An id nobody
 * registered is an error that names it — never a silent fallback to some other adapter.
 */
import { expect } from "chai";
import { PORT_NAMES, ok, fail, isOk } from "../../src/ports/index.js";
import {
  DEFAULT_ADAPTER, DEFAULT_SELECTION, UnknownAdapterError, buildPorts, pickAdapter, builtInProviders,
  selectionProblems, SELECTABLE_ADAPTERS, type AdapterProviders,
} from "../../src/adapters/registry.js";

/** Providers whose "ports" are just tags, so a test can see which factory answered. */
const tagged = (): AdapterProviders => ({
  workTracker: { github: () => ({ tag: "wt-github" }), memory: () => ({ tag: "wt-memory" }) },
  vcs: { github: () => ({ tag: "vcs-github" }), memory: () => ({ tag: "vcs-memory" }) },
  ciIdentity: { github: () => ({ tag: "ci-github" }), memory: () => ({ tag: "ci-memory" }) },
} as unknown as AdapterProviders);

describe("ports — Result", () => {
  it("ok carries a value; fail carries a reason and whether to retry", () => {
    expect(ok(3)).to.deep.equal({ ok: true, value: 3 });
    expect(fail("no such repo")).to.deep.equal({ ok: false, reason: "no such repo", retryable: false });
    expect(fail("timed out", true)).to.deep.equal({ ok: false, reason: "timed out", retryable: true });
    expect(isOk(ok(1))).to.equal(true);
    expect(isOk(fail("x"))).to.equal(false);
  });
});

describe("ports — the named port list", () => {
  it("names the three ports of spec 03 §6, once each", () => {
    expect([...PORT_NAMES].sort()).to.deep.equal(["ciIdentity", "vcs", "workTracker"]);
  });

  it("every port has a provider table and a default, and the default is github", () => {
    expect(DEFAULT_ADAPTER).to.equal("github");
    for (const p of PORT_NAMES) {
      expect(builtInProviders, p).to.have.property(p);
      expect(DEFAULT_SELECTION[p], p).to.equal("github");
      expect(SELECTABLE_ADAPTERS[p], p).to.include("github");
    }
  });

  it("every adapter gov registers is one an org may also select, or memory (tests only)", () => {
    for (const p of PORT_NAMES) {
      for (const id of Object.keys(builtInProviders[p])) {
        expect(id === "memory" || SELECTABLE_ADAPTERS[p].includes(id), `${p}: ${id}`).to.equal(true);
      }
    }
  });
});

describe("adapters — registry", () => {
  it("with no selection, every port is answered by the github adapter", () => {
    const ports = buildPorts(DEFAULT_SELECTION, tagged()) as unknown as Record<string, { tag: string }>;
    expect(ports.workTracker!.tag).to.equal("wt-github");
    expect(ports.vcs!.tag).to.equal("vcs-github");
    expect(ports.ciIdentity!.tag).to.equal("ci-github");
  });

  it("a selection picks each port's adapter by id", () => {
    const ports = buildPorts({ ...DEFAULT_SELECTION, vcs: "memory" }, tagged()) as unknown as Record<string, { tag: string }>;
    expect(ports.vcs!.tag).to.equal("vcs-memory");
    expect(ports.workTracker!.tag).to.equal("wt-github");
  });

  it("an unknown id is an error that names the id, the port, and what is registered", () => {
    let err: unknown;
    try { pickAdapter(tagged(), "vcs", "gitlab"); } catch (e) { err = e; }
    expect(err).to.be.instanceOf(UnknownAdapterError);
    const e = err as UnknownAdapterError;
    expect(e.port).to.equal("vcs");
    expect(e.id).to.equal("gitlab");
    expect(e.message).to.contain("'gitlab'").and.contain("vcs").and.contain("github").and.contain("memory");
  });

  it("an unknown id fails the whole build — no port silently falls back to another adapter", () => {
    expect(() => buildPorts({ ...DEFAULT_SELECTION, ciIdentity: "jenkins" }, tagged())).to.throw(UnknownAdapterError, /'jenkins'/);
  });

  it("a port with nothing registered says so", () => {
    const empty = { ...tagged(), vcs: {} } as AdapterProviders;
    expect(() => pickAdapter(empty, "vcs", "github")).to.throw(/'github'.*vcs.*none/);
  });

  it("selectionProblems names every bad id, and nothing when the selection is good", () => {
    expect(selectionProblems(DEFAULT_SELECTION)).to.deep.equal([]);
    const probs = selectionProblems({ ...DEFAULT_SELECTION, vcs: "gitlab", workTracker: "jira" });
    expect(probs).to.have.length(2);
    expect(probs.join("\n")).to.contain("gitlab").and.contain("jira");
  });

  it("memory is for tests: an org cannot select it", () => {
    expect(selectionProblems({ ...DEFAULT_SELECTION, vcs: "memory" }).join()).to.contain("memory");
  });
});

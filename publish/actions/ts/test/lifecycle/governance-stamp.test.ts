// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * "WHICH RULES WAS THIS JUDGED AGAINST?" — the stamp `gov merge` leaves (design §10.10).
 *
 * The tests that matter here are the ones about what the stamp must NOT do: replace a pull request body it did
 * not write, duplicate itself on a re-run (merge is forward-idempotent, so the same PR can be stamped twice),
 * or fail a merge that has already landed.
 */
import { expect } from "chai";
import {
  STAMP_BEGIN, STAMP_END, gatherGovernanceFacts, stampFacts, stampLines, withStamp,
} from "../../src/lifecycle/governance-stamp.js";
import { HARNESS_TARGETS } from "../../src/rules/harness-render.js";
import type { Fs } from "../../src/lifecycle/fs-io.js";
import { px } from "../helpers/paths.js";

const HOME = "/gov";

function memFs(seed: Record<string, string>): Fs {
  const files = new Map(Object.entries(seed).map(([k, v]) => [px(k), v]));
  return {
    pathExists: (p) => files.has(px(p)),
    readFile: (p) => files.get(px(p)) ?? null,
    writeFile: (p, c) => { files.set(px(p), c); },
    rm: (p) => { files.delete(px(p)); },
    mkdirp: () => {},
    readdir: () => [],
  };
}

/** A workspace that has been through `gov rules build`: nine rendered files and an org policy version. */
const built = (over: Record<string, string> = {}): Record<string, string> => ({
  ...Object.fromEntries(HARNESS_TARGETS.map((t) => [`${HOME}/agent/harness/${t.path}`, `rendered ${t.path}`])),
  [`${HOME}/policies/VERSION`]: "1.4.0\n",
  ...over,
});

describe("governance stamp — the three facts", () => {
  it("states the rules hash, the org policy version and the gov version, one greppable line each", () => {
    const got = gatherGovernanceFacts(memFs(built()), HOME, "1.2.3");
    expect(got.error).to.equal(undefined);
    const text = stampLines(got.facts!).join("\n");
    expect(text).to.match(/`gov-rules-hash: [0-9a-f]{16}`/);
    expect(text).to.contain("`gov-policy-version: 1.4.0`");
    expect(text).to.contain("`gov-version: 1.2.3`");
  });

  it("hashes the RENDERED files — what the agent had in context, not the policy prose", () => {
    const a = gatherGovernanceFacts(memFs(built()), HOME, "1.2.3").facts!;
    const b = gatherGovernanceFacts(memFs(built({ [`${HOME}/agent/harness/CLAUDE.md`]: "a different resident block" })), HOME, "1.2.3").facts!;
    expect(a.rulesHash).to.not.equal(b.rulesHash);
  });

  it("is stable across runs, so two merges under the same rules carry the same value", () => {
    const one = gatherGovernanceFacts(memFs(built()), HOME, "1.2.3").facts!;
    const two = gatherGovernanceFacts(memFs(built()), HOME, "1.2.3").facts!;
    expect(one.rulesHash).to.equal(two.rulesHash);
  });

  it("says a workspace has never rendered anything, rather than hashing the empty string", () => {
    const got = gatherGovernanceFacts(memFs({}), HOME, "1.2.3");
    expect(got.facts).to.equal(undefined);
    expect(got.error).to.contain("never run `gov rules build`");
  });

  it("an org with no policy history states 0.0.0, the version it stands at before its first rule", () => {
    const seed = built();
    delete seed[`${HOME}/policies/VERSION`];
    expect(gatherGovernanceFacts(memFs(seed), HOME, "1.2.3").facts!.policyVersion).to.equal("0.0.0");
  });
});

describe("governance stamp — putting it in a pull request body", () => {
  const lines = ["<!-- gov:governed-by -->", "x", "<!-- /gov:governed-by -->"];

  it("appends to a body, keeping every word the author wrote", () => {
    const out = withStamp("Fixes the thing.\n\n- one\n- two\n", lines);
    expect(out).to.contain("Fixes the thing.");
    expect(out).to.contain("- two");
    expect(out).to.contain(STAMP_BEGIN);
  });

  it("REPLACES an earlier stamp rather than adding a second — merge is forward-idempotent", () => {
    const first = withStamp("Body.", ["<!-- gov:governed-by -->", "old", "<!-- /gov:governed-by -->"]);
    const second = withStamp(first, ["<!-- gov:governed-by -->", "new", "<!-- /gov:governed-by -->"]);
    expect(second.split(STAMP_BEGIN)).to.have.length(2, "two blocks with different hashes is worse than none");
    expect(second).to.contain("new");
    expect(second).to.not.contain("old");
    expect(second).to.contain("Body.");
  });

  it("handles an empty body without leaving leading blank lines", () => {
    expect(withStamp("", lines)).to.equal(`${lines.join("\n")}\n`);
  });

  it("leaves the markers findable, so a year of pull requests can be grepped in one pass", () => {
    const out = withStamp("Body.", stampLines({ rulesHash: "f".repeat(16), policyVersion: "0.0.0", govVersion: "1.2.3" }));
    expect(out).to.contain(STAMP_BEGIN);
    expect(out).to.contain(STAMP_END);
    expect(out).to.contain("gov-rules-hash: ffffffffffffffff");
  });
});

describe("governance stamp — reading the facts back out for a terminal line", () => {
  it("picks the key: value lines and drops the markup, so the printed line and the block agree", () => {
    const lines = stampLines({ rulesHash: "a".repeat(16), policyVersion: "1.4.0", govVersion: "1.2.3" });
    expect(stampFacts(lines)).to.deep.equal([
      "gov-rules-hash: aaaaaaaaaaaaaaaa",
      "gov-policy-version: 1.4.0",
      "gov-version: 1.2.3",
    ]);
  });

  it("ignores the prose line and the markers", () => {
    expect(stampFacts([STAMP_BEGIN, "**Governed by** — prose `with a tick`:", STAMP_END])).to.deep.equal([]);
  });
});

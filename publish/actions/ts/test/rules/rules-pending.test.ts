// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * THE MARKER THAT STOPS WORK UNTIL THE SESSION RESTARTS (design §8).
 *
 * Every test here names a way the mechanism could be worthless rather than broken: a change detector that fires
 * on a reflow (so people learn to clear it reflexively), a corrupt marker that silently re-opens every mutating
 * verb, a refusal that says "the rules changed" and names nothing.
 */
import { expect } from "chai";
import * as path from "node:path";
import {
  PENDING_FILE, changedCites, clearPending, isMutatingVerb, pendingPath, readPending, refuseForPendingRules,
  residentCues, rulesHash, writePending, type RulesPending,
} from "../../src/rules-pending.js";
import { assembleResidentBlock } from "../../src/rules/harness-render.js";
import type { Fs } from "../../src/lifecycle/fs-io.js";
import { px } from "../helpers/paths.js";

/** A disk that is a Map, keyed the way the production code composes paths. */
function memFs(seed: Record<string, string> = {}): Fs & { readonly files: Map<string, string> } {
  const files = new Map(Object.entries(seed).map(([k, v]) => [px(k), v]));
  return {
    files,
    pathExists: (p) => files.has(px(p)),
    readFile: (p) => files.get(px(p)) ?? null,
    writeFile: (p, c) => { files.set(px(p), c); },
    rm: (p) => { files.delete(px(p)); },
    mkdirp: () => {},
    readdir: () => [],
  };
}

const PENDING: RulesPending = {
  hash: "aaaabbbbccccdddd", previous: "1111222233334444",
  clauses: ["POL-086b · C01", "POL-427 · C01"],
  at: "2026-09-28T10:12:44.000Z", by: "sync",
};

describe("rules-pending — where the marker lives", () => {
  it("is one file in the PERSON's state dir, beside ack/ and cache/", () => {
    expect(px(pendingPath("/awr", "rkant"))).to.equal(`/awr/preferences/rkant/state/${PENDING_FILE}`);
  });

  it("is keyed by person, not by workspace — two people share a clone and only one session is stale", () => {
    expect(pendingPath("/awr", "rkant")).to.not.equal(pendingPath("/awr", "someone-else"));
  });
});

describe("rules-pending — what counts as a changed rule", () => {
  const block = (cues: readonly { cite: string; level: string; cue: string }[]): string =>
    assembleResidentBlock([{ path: "policies/p.md", text: cues.map((c) =>
      `### 1.1 S\n\nA rule. **(${c.cite})**\n\n<!-- gov:cue generated clause-sha=x -->\n> **Always in the agent's context** · ${c.cite} · ${c.level}\n> ${c.cue}\n`,
    ).join("\n") }]) as string;

  it("reads back the citations the renderer wrote — the two modules agree on one heading shape", () => {
    const cues = residentCues(block([{ cite: "POL-086b", level: "C01", cue: "A BRANCH EDIT IS A PROPOSAL." }]));
    expect([...cues.keys()]).to.deep.equal(["POL-086b · C01"]);
    expect(cues.get("POL-086b · C01")).to.equal("A BRANCH EDIT IS A PROPOSAL.");
  });

  it("reports a cue whose TEXT changed", () => {
    const before = residentCues(block([{ cite: "POL-001", level: "C01", cue: "STOP." }]));
    const after = residentCues(block([{ cite: "POL-001", level: "C01", cue: "STOP, AND SAY WHY." }]));
    expect(changedCites(before, after)).to.deep.equal(["POL-001 · C01"]);
  });

  it("reports a cue that APPEARED and one that was REMOVED, told apart", () => {
    const before = residentCues(block([{ cite: "POL-001", level: "C01", cue: "STOP." }]));
    const after = residentCues(block([{ cite: "POL-002", level: "C02", cue: "GO." }]));
    expect(changedCites(before, after)).to.deep.equal(["POL-001 · C01 (removed)", "POL-002 · C02"]);
  });

  it("reports NOTHING when the rules are the same — the property that keeps the refusal meaningful", () => {
    const same = block([{ cite: "POL-001", level: "C01", cue: "STOP." }, { cite: "POL-002", level: "C02", cue: "GO." }]);
    expect(changedCites(residentCues(same), residentCues(same))).to.deep.equal([]);
  });

  it("hashes the rendered FILES, path included — a file appearing is a change to what an agent reads", () => {
    const a = [{ path: "CLAUDE.md", content: "x" }];
    expect(rulesHash(a)).to.equal(rulesHash(a));
    expect(rulesHash(a)).to.not.equal(rulesHash([...a, { path: "AGENTS.md", content: "x" }]));
  });

  it("does not depend on the order the caller listed them", () => {
    const one = [{ path: "AGENTS.md", content: "a" }, { path: "CLAUDE.md", content: "b" }];
    expect(rulesHash(one)).to.equal(rulesHash([...one].reverse()));
  });
});

describe("rules-pending — the refusal", () => {
  it("names the changed clauses, because 'the rules changed' with no referent reads as a bug", () => {
    const lines = refuseForPendingRules(PENDING, "merge").join("\n");
    expect(lines).to.contain("gov merge: refused");
    expect(lines).to.contain("POL-086b · C01");
    expect(lines).to.contain("POL-427 · C01");
  });

  it("says which command recorded it, when, and which hash — so it can be reconciled with the log", () => {
    const lines = refuseForPendingRules(PENDING, "task").join("\n");
    expect(lines).to.contain("`gov sync`");
    expect(lines).to.contain("2026-09-28T10:12:44.000Z");
    expect(lines).to.contain("aaaabbbbccccdddd");
    expect(lines).to.contain("was 1111222233334444");
  });

  it("names BOTH ways out — the launch and the attestation", () => {
    const lines = refuseForPendingRules(PENDING, "close").join("\n");
    expect(lines).to.contain("gov work");
    expect(lines).to.contain("gov rules reload");
  });

  it("caps the list rather than printing a wall of citations nobody reads", () => {
    const many = { ...PENDING, clauses: Array.from({ length: 30 }, (_, i) => `POL-${100 + i} · C02`) };
    const lines = refuseForPendingRules(many, "task");
    expect(lines.filter((l) => /^ {4}POL-/.test(l))).to.have.length(12);
    expect(lines.join("\n")).to.contain("… and 18 more");
  });

  it("still refuses when no clause could be named, and says where to look", () => {
    const lines = refuseForPendingRules({ ...PENDING, clauses: [] }, "task").join("\n");
    expect(lines).to.contain("gov task: refused");
    expect(lines).to.contain("gov rules report");
  });
});

describe("rules-pending — which verbs it closes", () => {
  it("closes task, merge, close and every knowledge verb that LANDS something", () => {
    expect(isMutatingVerb("task")).to.equal(true);
    expect(isMutatingVerb("merge")).to.equal(true);
    expect(isMutatingVerb("close")).to.equal(true);
    expect(isMutatingVerb("knowledge", "propose")).to.equal(true);
    // ADDED 2026-09-28, past the letter of §8: `submit` opens the pull request asking an owner to ratify, and
    // `archive` retires a document. Gating only `propose` would have closed the cheapest of the three governance
    // verbs and left the two that actually reach GitHub open.
    expect(isMutatingVerb("knowledge", "submit")).to.equal(true);
    expect(isMutatingVerb("knowledge", "archive")).to.equal(true);
  });

  it("leaves the read-only verbs alone — a bricked workspace is worse than the thing this prevents", () => {
    for (const v of ["status", "list", "anchor", "validate", "rules", "manage", "org", "doctor", "log"]) {
      expect(isMutatingVerb(v), v).to.equal(false);
    }
    for (const sub of ["search", "show", "list"]) expect(isMutatingVerb("knowledge", sub), sub).to.equal(false);
  });
});

describe("rules-pending — reading and clearing it", () => {
  it("round-trips", () => {
    const fs = memFs();
    writePending(fs, "/awr", "rkant", PENDING);
    expect(readPending(fs, "/awr", "rkant")).to.deep.equal(PENDING);
  });

  it("is absent until something records it", () => {
    expect(readPending(memFs(), "/awr", "rkant")).to.equal(null);
  });

  it("clearing removes the file, and a second read finds nothing", () => {
    const fs = memFs();
    writePending(fs, "/awr", "rkant", PENDING);
    clearPending(fs, "/awr", "rkant");
    expect(readPending(fs, "/awr", "rkant")).to.equal(null);
  });

  it("a CORRUPT marker still refuses — a truncated write must not re-open every mutating verb", () => {
    const fs = memFs({ [path.join("/awr", "preferences", "rkant", "state", PENDING_FILE)]: '{"hash":"aaa' });
    const got = readPending(fs, "/awr", "rkant");
    expect(got, "returning null here would silently unblock the merge this exists to stop").to.not.equal(null);
    expect(got!.hash).to.equal("unreadable");
  });

  it("an EMPTY marker file is no marker — that is a cleared one, not a corrupt one", () => {
    const fs = memFs({ [path.join("/awr", "preferences", "rkant", "state", PENDING_FILE)]: "\n" });
    expect(readPending(fs, "/awr", "rkant")).to.equal(null);
  });
});

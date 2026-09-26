// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * THE POL LOCKFILE (rules-and-cues-design.md §3).
 *
 * What these tests hold to: a number is allocated once and never reused or renumbered — POL-427 is cited in gov's
 * own source code, so a renumbering would silently re-point a live citation at a different rule; a retired clause
 * keeps its entry; and when the compiler cannot match a clause EXACTLY it stops and asks, because both silent
 * answers are wrong in a way nobody would notice for months.
 */
import { expect } from "chai";
import {
  FRAMEWORK_POL_START, ORG_POL_START, allocate, allocateNew, confirmMatch, emptyLock, formatAsk, formatPol,
  nextNumber, polNumber, retire, type ClauseIdentity, type PolLock,
} from "../../src/rules/pol-lock.js";

const id = (doc: string, section: string, clauseSha: string): ClauseIdentity => ({ doc, section, clauseSha });
const STACK = id("policies/approved.md", "4.2", "8f2a1c4");

/** An org lock holding exactly POL-210 for §4.2 of the approved-technologies document. */
const locked = (): PolLock => {
  const r = allocate(emptyLock(ORG_POL_START + 10), STACK);
  expect(r.pol).to.equal("POL-210");
  return r.lock;
};

describe("pol-lock — allocating a number", () => {
  it("allocates from the range it was given, not from a range it knows about", () => {
    // The framework's lock and an org's differ ONLY by the starting number. A compiler that knew about "the
    // framework range" and "the org range" would need a third case the first time a second document set ships.
    expect(allocate(emptyLock(FRAMEWORK_POL_START), STACK).pol).to.equal("POL-001");
    expect(allocate(emptyLock(ORG_POL_START), STACK).pol).to.equal("POL-200");
    expect(allocate(emptyLock(900), STACK).pol).to.equal("POL-900");
  });

  it("pads to three digits, because every citation that exists already does", () => {
    expect(formatPol(1)).to.equal("POL-001");
    expect(formatPol(210)).to.equal("POL-210");
    expect(polNumber("POL-086b"), "the hand-assigned era left suffixed ids").to.equal(86);
  });

  it("the next number is max + 1, never a gap-filler", () => {
    // THE HAZARD: filling a gap left by a retired clause hands a live rule a number that decisions, exception
    // files and commit messages already use for something else.
    const lock: PolLock = { start: 200, entries: [{ pol: "POL-204", ...STACK }, { pol: "POL-201", ...id("d", "1", "a") }] };
    expect(nextNumber(lock)).to.equal(205);
    expect(allocate(lock, id("d", "9", "zzz")).pol).to.equal("POL-205");
  });

  it("allocating APPENDS and leaves every existing entry untouched", () => {
    const before = locked();
    const after = allocate(before, id("policies/approved.md", "4.3", "aaa1111")).lock;
    expect(after.entries).to.have.length(2);
    expect(after.entries[0], "append-only: the first entry is the same object's content").to.deep.equal(before.entries[0]);
    expect(before.entries, "and the lock passed in was not mutated").to.have.length(1);
  });

  it("records the level when the caller knows it", () => {
    expect(allocate(emptyLock(200), STACK, "C02").lock.entries[0]!.level).to.equal("C02");
  });
});

describe("pol-lock — an exact identity reuses its number", () => {
  it("the same clause, in the same place, with the same text keeps its number", () => {
    const r = allocate(locked(), STACK);
    expect(r.action).to.equal("reused");
    expect(r.pol).to.equal("POL-210");
  });

  it("reuse changes nothing in the lock — a rebuild of an unchanged policy is a no-op", () => {
    const lock = locked();
    expect(allocate(lock, STACK).lock).to.equal(lock);
  });
});

describe("pol-lock — when it cannot match, it ASKS (§3)", () => {
  it("same section, different text → ask, with the candidate to name in the question", () => {
    const r = allocate(locked(), id("policies/approved.md", "4.2", "9999999"));
    expect(r.action).to.equal("ask");
    expect(r.pol, "no number is handed out on a guess").to.equal(null);
    expect(r.reason).to.equal("reworded");
    expect(r.candidate!.pol).to.equal("POL-210");
  });

  it("same text, different section → ask (moved), not a second allocation", () => {
    // THE HAZARD: allocating a new number here leaves every citation of POL-210 pointing at a rule that has been
    // retired out from under it, while the live clause carries a number nothing cites.
    const r = allocate(locked(), id("policies/approved.md", "9.1", "8f2a1c4"));
    expect(r.action).to.equal("ask");
    expect(r.reason).to.equal("moved");
    expect(r.candidate!.section).to.equal("4.2");
  });

  it("same text in a DIFFERENT document is also a move", () => {
    const r = allocate(locked(), id("policies/other.md", "1.1", "8f2a1c4"));
    expect(r.reason).to.equal("moved");
    expect(formatAsk(id("policies/other.md", "1.1", "8f2a1c4"), r)).to.contain("policies/approved.md");
  });

  it("a rewording is asked about BEFORE a move when both readings are available", () => {
    // Editing §4.2 in place is the common case by a wide margin, and it is the question a person can answer from
    // what is on their screen.
    const lock: PolLock = {
      start: 200,
      entries: [{ pol: "POL-210", ...STACK }, { pol: "POL-211", ...id("policies/approved.md", "4.9", "bbb2222") }],
    };
    const r = allocate(lock, id("policies/approved.md", "4.2", "bbb2222"));
    expect(r.reason).to.equal("reworded");
    expect(r.candidate!.pol).to.equal("POL-210");
  });

  it("an ask never writes: the lock comes back exactly as it went in", () => {
    const lock = locked();
    expect(allocate(lock, id("policies/approved.md", "4.2", "9999999")).lock).to.equal(lock);
  });

  it("the question is the one §3 specifies, and names both answers", () => {
    const moved = id("policies/approved.md", "4.2", "9999999");
    const text = formatAsk(moved, allocate(locked(), moved));
    expect(text).to.contain("§4.2").and.contain("POL-210").and.contain("reworded");
    expect(text).to.contain("confirm").and.contain("allocate a new number");
  });

  it("formatAsk is empty when nothing is being asked", () => {
    expect(formatAsk(STACK, allocate(locked(), STACK))).to.equal("");
  });

  it("nothing resembling an existing entry is simply allocated — no question where there is no doubt", () => {
    const r = allocate(locked(), id("policies/other.md", "2.1", "ccc3333"));
    expect(r.action).to.equal("allocated");
    expect(r.pol).to.equal("POL-211");
  });
});

describe("pol-lock — answering the question", () => {
  const reworded = id("policies/approved.md", "4.2", "9999999");

  it("confirming keeps the NUMBER and updates what it points at", () => {
    const lock = confirmMatch(locked(), "POL-210", reworded, "C01");
    expect(lock.entries).to.have.length(1);
    expect(lock.entries[0]!.pol).to.equal("POL-210");
    expect(lock.entries[0]!.clauseSha).to.equal("9999999");
    expect(lock.entries[0]!.level).to.equal("C01");
    expect(allocate(lock, reworded).action, "and the next build is quiet").to.equal("reused");
  });

  it("confirming keeps the identity it USED to have, so an incident can be reconstructed", () => {
    // Without this, the sha that was approved in PR #214 is gone, and a year later nobody can establish which
    // text the number was allocated for.
    const lock = confirmMatch(locked(), "POL-210", reworded);
    expect(lock.entries[0]!.history).to.deep.equal([STACK]);
  });

  it("confirming touches no other entry", () => {
    const two = allocate(locked(), id("policies/approved.md", "4.3", "aaa1111")).lock;
    const after = confirmMatch(two, "POL-210", reworded);
    expect(after.entries[1]).to.deep.equal(two.entries[1]);
  });

  it('"no, it is a new rule" allocates the next number and leaves the old entry alone', () => {
    const lock = allocateNew(locked(), reworded);
    expect(lock.pol).to.equal("POL-211");
    expect(lock.lock.entries[0]!.clauseSha, "POL-210 still points at what it was allocated for").to.equal("8f2a1c4");
  });
});

describe("pol-lock — retirement keeps the number (§3)", () => {
  it("retiring marks the entry and keeps it, so an old citation still resolves", () => {
    const lock = retire(locked(), "POL-210");
    expect(lock.entries).to.have.length(1);
    expect(lock.entries[0]!.retired).to.equal(true);
  });

  it("a retired number is NEVER handed out again", () => {
    // THE HAZARD: reuse makes a five-year-old decision that cites POL-210 resolve to a different rule — and it
    // still resolves, so nothing anywhere reports a problem.
    const lock = retire(locked(), "POL-210");
    expect(nextNumber(lock)).to.equal(211);
    expect(allocate(lock, id("policies/other.md", "1.1", "ddd4444")).pol).to.equal("POL-211");
  });

  it("a clause that comes back VERBATIM at a retired number is an ask, not a silent resurrection", () => {
    const r = allocate(retire(locked(), "POL-210"), STACK);
    expect(r.action).to.equal("ask");
    expect(r.reason).to.equal("retired");
    expect(formatAsk(STACK, r)).to.contain("retired");
  });

  it("a retired entry is not offered as a rewording or a move candidate either", () => {
    const lock = retire(locked(), "POL-210");
    expect(allocate(lock, id("policies/approved.md", "4.2", "9999999")).action).to.equal("allocated");
    expect(allocate(lock, id("policies/other.md", "1.1", "8f2a1c4")).action).to.equal("allocated");
  });

  it("confirming a retired number brings it back, because that is what the person just decided", () => {
    const lock = confirmMatch(retire(locked(), "POL-210"), "POL-210", STACK);
    expect(lock.entries[0]!.retired, "reversed, and visibly so in the file").to.equal(false);
    expect(allocate(lock, STACK).action).to.equal("reused");
  });
});

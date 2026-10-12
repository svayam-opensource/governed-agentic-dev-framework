// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
import { expect } from "chai";
import { Transaction } from "../../src/lifecycle/transaction.js";

describe("prj-work Phase 2 — Transaction (rollback engine)", () => {
  it("runs forward steps and returns their results", () => {
    const tx = new Transaction();
    const a = tx.step("a", () => 1, () => {});
    const b = tx.step("b", () => "x", () => {});
    expect([a, b]).to.deep.equal([1, "x"]);
    expect(tx.pending).to.equal(2);
  });

  it("rolls back undos newest-first (LIFO), passing each step's result", () => {
    const log: string[] = [];
    const tx = new Transaction();
    tx.step("mkdir", () => "/p", (p) => log.push(`rmdir ${p}`));
    tx.step("worktree", () => "wt", (w) => log.push(`remove ${w}`));
    tx.onRollback("reset", () => log.push("reset HEAD"));
    const failures = tx.rollback();
    expect(failures).to.deep.equal([]);
    expect(log).to.deep.equal(["reset HEAD", "remove wt", "rmdir /p"]);
    expect(tx.pending).to.equal(0);
  });

  it("commit() disarms rollback", () => {
    const log: string[] = [];
    const tx = new Transaction();
    tx.step("s", () => 0, () => log.push("undone"));
    tx.commit();
    expect(tx.rollback()).to.deep.equal([]);
    expect(log).to.deep.equal([]);
  });

  it("is best-effort: a throwing undo is collected, the rest still run", () => {
    const log: string[] = [];
    const tx = new Transaction();
    tx.step("ok-first", () => 0, () => log.push("first"));
    tx.step("boom", () => 0, () => {
      throw new Error("stuck");
    });
    tx.step("ok-last", () => 0, () => log.push("last"));
    const failures = tx.rollback();
    expect(log).to.deep.equal(["last", "first"]); // both non-throwing undos ran
    expect(failures).to.have.lengthOf(1);
    expect(failures[0].label).to.equal("boom");
    expect((failures[0].error as Error).message).to.equal("stuck");
  });

  // gadf#180: a failed seed says what state it left behind. The transaction is the one place that knows.
  it("reports what it created, what it rolled back, and what it left behind", () => {
    const tx = new Transaction();
    tx.step("work root /w", () => 0, () => {});
    tx.step("worktree /w/gov", () => 0, () => { throw new Error("busy"); });
    tx.onRollback("tag x", () => {});
    expect(() => tx.step("push /w/gov", () => { throw new Error("rejected"); }, () => {})).to.throw("rejected");
    tx.rollback();
    const r = tx.report();
    expect(r.created).to.deep.equal(["work root /w", "worktree /w/gov", "tag x"]);
    expect(r.rolledBack).to.deep.equal(["tag x", "work root /w"]);
    expect(r.leftBehind).to.deep.equal(["worktree /w/gov (busy)"]);
    expect(tx.summary()).to.equal("created: work root /w, worktree /w/gov, tag x; rolled back: tag x, work root /w; left behind: worktree /w/gov (busy)");
  });

  it("says 'nothing' rather than an empty list", () => {
    const tx = new Transaction();
    tx.rollback();
    expect(tx.summary()).to.equal("created: nothing; rolled back: nothing; left behind: nothing");
  });
});

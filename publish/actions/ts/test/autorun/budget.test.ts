// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/** Spec 03 Q11 — per item 30 min, per run 10 items / 10 CRs, set in governance.yaml; flags may only lower them. */
import { expect } from "chai";
import { readBudget, RunBudget, DEFAULT_BUDGET } from "../../src/autorun/budget.js";

describe("autorun — budget", () => {
  it("defaults are Q11's: 30 min per item, 10 items and 10 CRs per run", () => {
    expect(DEFAULT_BUDGET).to.deep.equal({ itemMinutes: 30, runItems: 10, runCrs: 10 });
    expect(readBudget(null).budget).to.deep.equal(DEFAULT_BUDGET);
  });

  it("governance.yaml's autorun block sets them", () => {
    const r = readBudget("autorun:\n  item_minutes: 20\n  run_items: 4\n  run_crs: 3\n");
    expect(r).to.deep.equal({ budget: { itemMinutes: 20, runItems: 4, runCrs: 3 }, problems: [] });
  });

  it("a bad value is a problem and the default is kept for it", () => {
    const r = readBudget("autorun:\n  item_minutes: lots\n");
    expect(r.budget.itemMinutes).to.equal(30);
    expect(r.problems.join()).to.match(/item_minutes/);
  });

  it("--max-minutes may lower the item budget, never raise it past governance", () => {
    expect(readBudget(null, { maxMinutes: 5 }).budget.itemMinutes).to.equal(5);
    const r = readBudget(null, { maxMinutes: 90 });
    expect(r.budget.itemMinutes).to.equal(30);
    expect(r.problems.join()).to.match(/90/);
  });

  it("the run tracker stops at the item ceiling and at the CR ceiling", () => {
    const b = new RunBudget({ itemMinutes: 30, runItems: 2, runCrs: 1 });
    expect(b.canStartItem()).to.equal(true); b.itemStarted();
    expect(b.canOpenCr()).to.equal(true); b.crOpened();
    expect(b.canOpenCr()).to.equal(false);
    expect(b.canStartItem()).to.equal(true); b.itemStarted();
    expect(b.canStartItem()).to.equal(false);
    expect(b.exhausted()).to.match(/2 items/);
  });
});

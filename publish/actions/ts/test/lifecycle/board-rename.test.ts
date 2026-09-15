// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * NAMING THE BOARD WHAT GOV CALLS IT (Policy Owner, 2026-09-15).
 *
 * A board someone titles "Invoice API" becomes `PRJ-26-invoice-api` in every branch, directory
 * and document gov writes, and nothing on GitHub said so. gov now prefixes the title at seed.
 *
 * THE TRAP THAT HAD TO BE CLOSED FIRST, and the reason most of this file exists.
 * `deriveProjectIdentity` reads the LIVE board title on every `gov work` — three call sites in
 * work-flow.ts — not only at seed. So renaming a board to `PRJ-26 · Invoice API` derived
 * `PRJ-26-prj-26-invoice-api` next time, and the project stopped matching its own directory and
 * branch: invisible to the picker, while `close` and `merge` kept working because they read the
 * id from the branch. The rename was unsafe, and so was anyone tidying a title BY HAND.
 */
import { expect } from "chai";
import { deriveProjectIdentity, slugify, boardTitleFor, titleWithoutProjectPrefix } from "../../src/lifecycle/identity.js";

const URL26 = "https://github.com/orgs/acme/projects/26";
const id = (title: string): string => {
  const r = deriveProjectIdentity({ url: URL26, title });
  return r.ok ? r.projectId : `ERR:${r.reason}`;
};

describe("board title ↔ project id", () => {
  it("derivation is IDEMPOTENT — a prefixed title yields the same id", () => {
    // Without this, renaming the board breaks the project that the rename was meant to clarify.
    expect(id("Invoice API")).to.equal("PRJ-26-invoice-api");
    expect(id("PRJ-26 · Invoice API"), "the title gov writes").to.equal("PRJ-26-invoice-api");
    expect(id("PRJ-26-invoice-api"), "a bare-id rename by hand").to.equal("PRJ-26-invoice-api");
    expect(id("prj-26 - Invoice API"), "a person's spelling of it").to.equal("PRJ-26-invoice-api");
  });

  it("strips repeatedly, so no amount of hand-prefixing can break a board", () => {
    // One pass left `PRJ-7 · PRJ-26 · Odd` deriving `PRJ-26-prj-26-odd` — the same defect,
    // needing two prefixes instead of one.
    expect(id("PRJ-7 · PRJ-26 · Odd")).to.equal("PRJ-26-odd");
    expect(titleWithoutProjectPrefix("PRJ-1 · PRJ-2 · PRJ-3 · Deep")).to.equal("Deep");
  });

  it("the prefix strip does not eat a title that merely mentions a project", () => {
    // `PRJ-` only counts as gov's own prefix at the START, followed by digits and a separator.
    expect(titleWithoutProjectPrefix("Migrate PRJ-26 to the new API")).to.equal("Migrate PRJ-26 to the new API");
    expect(titleWithoutProjectPrefix("PRJ-ONE · not a number")).to.equal("PRJ-ONE · not a number");
  });

  it("the title gov writes keeps the human words", () => {
    // The bare id would match the docs exactly and make a board list unreadable. The id answers
    // "which project is this in gov"; the words answer "what is it".
    expect(boardTitleFor("PRJ-26-invoice-api", "Invoice API")).to.equal("PRJ-26 · Invoice API");
    expect(boardTitleFor("PRJ-26-invoice-api", "  Invoice API  "), "trimmed").to.equal("PRJ-26 · Invoice API");
  });

  it("writing the title twice is a no-op, not a doubling", () => {
    const once = boardTitleFor("PRJ-26-invoice-api", "Invoice API");
    expect(boardTitleFor("PRJ-26-invoice-api", once)).to.equal(once);
  });

  it("leaves the title alone when it cannot improve it", () => {
    // A title that is nothing but a prefix has no human half to keep, and an id gov cannot parse
    // is not something to build a title from. Returning the original beats inventing one.
    expect(boardTitleFor("PRJ-26-x", "PRJ-26 · ")).to.equal("PRJ-26 · ");
    expect(boardTitleFor("not-a-project-id", "Invoice API")).to.equal("Invoice API");
  });

  it("slugify still behaves for every title that carries no prefix", () => {
    // The strip must not have changed the baseline behaviour, which is byte-for-byte lib.sh.
    expect(slugify("Invoice API")).to.equal("invoice-api");
    expect(slugify("A  B---C")).to.equal("a-b-c");
    expect(slugify("--trim--")).to.equal("trim");
    expect(slugify("日本語"), "no ASCII alphanumerics → empty, rejected by the caller").to.equal("");
  });
});

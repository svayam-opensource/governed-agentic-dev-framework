// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * STARTERS WITHOUT HEADER LINES (PRJ-121 intent 01, ruling Q10 — task L08).
 *
 * Every seeded policy used to open with `**Document:** / **Policy Owner:** / **Status:**` lines. I01.3 dropped header
 * tables: the path is the header, and an owner line in a file nobody keeps current is a second, staler copy of the
 * role list. Removed from the shipped starters — new orgs only; an org's existing files are its own and untouched.
 */
import { expect } from "chai";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const POLICIES = fileURLToPath(new URL("../../../../content/policies/", import.meta.url));
const HEADER = /^\*\*(Document|Policy Owner|Owner|Status):\*\*/;

function walk(dir: string, rel = ""): string[] {
  return fs.readdirSync(path.join(dir, rel), { withFileTypes: true }).flatMap((e) => {
    const r = rel ? `${rel}/${e.name}` : e.name;
    return e.isDirectory() ? walk(dir, r) : [r];
  });
}

/** The lines before the first section heading or callout: where a document header sits. */
const headOf = (text: string): string[] => {
  const lines = text.split("\n");
  const end = lines.findIndex((l, i) => i > 0 && (/^#{2,} /.test(l) || /^> /.test(l)));
  return lines.slice(0, end === -1 ? 12 : end);
};

describe("shipped starters carry no Document / Policy Owner / Status lines (Q10, L08)", () => {
  const starters = walk(POLICIES).filter((f) => f.endsWith(".md") && f !== "CHANGELOG.md");

  it("there are starters to check", () => expect(starters.length).to.be.greaterThan(3));

  for (const f of starters) {
    it(`policies/${f} opens with its title and no header lines`, () => {
      const text = fs.readFileSync(path.join(POLICIES, f), "utf8");
      expect(text, "a title first").to.match(/^# /);
      expect(headOf(text).filter((l) => HEADER.test(l)), `header lines in policies/${f}`).to.deep.equal([]);
    });
  }
});

// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
//
// GHSA-4p3w-j4w9-5jqw (moment path traversal, fixed in 2.31.0) — PRJ-121 intent 05, Item 11 / T12.
// gov reaches moment only through @svayam-opensource/svm-util-log → winston-daily-rotate-file →
// file-stream-rotator. svm-util-log 1.1.1 carries a direct `moment ^2.31.0` floor that travels to every
// consumer, so gov's own range must REQUIRE 1.1.1: `^1.1.0` would still accept the vulnerable 1.1.0.
// The node-ci `npm audit --omit=dev --audit-level=moderate` step is the live check; these are the static
// guards that fail in `npm test` before CI is reached.
import { expect } from "chai";
import { readFileSync } from "node:fs";
import * as path from "node:path";
import { PKG_ROOT } from "../helpers/lib-fresh.js";

const pkg = JSON.parse(readFileSync(path.join(PKG_ROOT, "package.json"), "utf8"));
const lock = JSON.parse(readFileSync(path.join(PKG_ROOT, "package-lock.json"), "utf8"));

function parse(v: string): number[] {
  return v.replace(/^[\^~>=\s]+/, "").split("-")[0].split(".").map(Number);
}
function atLeast(v: string, floor: string): boolean {
  const a = parse(v), b = parse(floor);
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i];
  return true;
}

describe("moment advisory GHSA-4p3w-j4w9-5jqw stays fixed (Item 11)", () => {
  it("package.json requires svm-util-log >= 1.1.1 (the release with the moment floor)", () => {
    const range: string = pkg.dependencies["@svayam-opensource/svm-util-log"];
    expect(range, "svm-util-log range").to.match(/^\^1\./);
    expect(atLeast(range, "1.1.1"), `range ${range} admits a release without the moment floor`).to.equal(true);
  });

  it("the lockfile resolves svm-util-log >= 1.1.1 and every moment >= 2.31.0", () => {
    const packages: Record<string, { version?: string }> = lock.packages;
    const util = packages["node_modules/@svayam-opensource/svm-util-log"];
    expect(util?.version, "locked svm-util-log").to.be.a("string");
    expect(atLeast(util.version!, "1.1.1"), `locked svm-util-log ${util.version}`).to.equal(true);
    const moments = Object.entries(packages).filter(([k]) => k === "node_modules/moment" || k.endsWith("/node_modules/moment"));
    expect(moments, "moment is in the tree").to.not.be.empty;
    for (const [where, p] of moments) {
      expect(atLeast(p.version!, "2.31.0"), `${where} is ${p.version}`).to.equal(true);
    }
  });
});

// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * The output vocabulary (#204). What is worth pinning is not the escape codes — it is that the
 * meaning survives without them, because colour is the part most likely to be absent.
 */
import { expect } from "chai";
import { useColor, paint, reporter } from "../../src/cli/format.js";

const ARROW = "\u2192", TICK = "\u2713", CROSS = "\u2717";
const CYAN = "\u001b[36m", GREEN = "\u001b[32m", RED = "\u001b[31m", RESET = "\u001b[0m";

describe("gov-work — when colour is used (#204)", () => {
  it("a terminal gets it; a pipe or a log file does not", () => {
    expect(useColor({ isTty: true, env: {} })).to.equal(true);
    expect(useColor({ isTty: false, env: {} })).to.equal(false);
  });

  it("NO_COLOR is obeyed even on a terminal — it is not a preference to override", () => {
    expect(useColor({ isTty: true, env: { NO_COLOR: "1" } })).to.equal(false);
    expect(useColor({ isTty: true, env: { NO_COLOR: "" } }), "set-but-empty still means no").to.equal(false);
  });

  it("TERM=dumb is the terminal saying the same thing", () => {
    expect(useColor({ isTty: true, env: { TERM: "dumb" } })).to.equal(false);
  });

  it("FORCE_COLOR wins, both ways — CI writes to a pipe and still wants it", () => {
    expect(useColor({ isTty: false, env: { FORCE_COLOR: "1" } })).to.equal(true);
    expect(useColor({ isTty: true, env: { FORCE_COLOR: "0" } })).to.equal(false);
    expect(useColor({ isTty: true, env: { FORCE_COLOR: "1", NO_COLOR: "1" } }), "explicit beats implicit").to.equal(true);
  });
});

describe("gov-work — the two marks (#204)", () => {
  const plain = reporter(false);

  it("one mark for under way, one for true now, one for did not happen — each survives with no colour", () => {
    expect(plain.step("Fetching the latest version...")).to.equal(`  ${ARROW} Fetching the latest version...`);
    expect(plain.ok("Bob Shell 2.0.2 installed")).to.equal(`  ${TICK} Bob Shell 2.0.2 installed`);
    expect(plain.fail("integrity check failed")).to.equal(`  ${CROSS} integrity check failed`);
  });

  it("a phase is set off by blank lines — the reader's 'where am I'", () => {
    expect(plain.phase("Verifying Package Integrity")).to.deep.equal(["", "Verifying Package Integrity", ""]);
  });

  it("colour carries the same distinction, never a different one", () => {
    const c = reporter(true);
    expect(c.step("x")).to.contain(CYAN);
    expect(c.ok("x")).to.contain(GREEN);
    expect(c.fail("x")).to.contain(RED);
    for (const line of [c.step("x"), c.ok("x"), c.fail("x")]) expect(line).to.contain(RESET);
  });

  it("stripping the codes gives back exactly the plain form — the MARK is the meaning", () => {
    const c = reporter(true);
    // eslint-disable-next-line no-control-regex
    const strip = (s: string) => s.replace(/\u001b\[\d+m/g, "");
    expect(strip(c.step("x"))).to.equal(plain.step("x"));
    expect(strip(c.ok("x"))).to.equal(plain.ok("x"));
    expect(strip(c.fail("x"))).to.equal(plain.fail("x"));
    expect(c.phase("T").map(strip)).to.deep.equal(plain.phase("T"));
    expect(c.complete("Done").map(strip)).to.deep.equal(plain.complete("Done"));
  });

  it("paint is the only place a code is written, and it no-ops when off", () => {
    expect(paint("x", "green", false)).to.equal("x");
    expect(paint("x", "green", true)).to.equal(`${GREEN}x${RESET}`);
  });
});

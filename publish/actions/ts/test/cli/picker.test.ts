// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * The shared picker (PRJ-121 F158, ruling Q12 A): arrows in a real terminal, the numbered prompt everywhere else,
 * and the terminal always handed back.
 */
import { expect } from "chai";
import { EventEmitter } from "node:events";
import {
  pickOne, pickMany, arrowsAvailable, readKeys, parseNumbered, numberedLabel, frame,
  SINGLE_HINT, MULTI_HINT, PLAIN_PROMPTS_ENV, type PickSpec, type PickerTerminal,
} from "../../src/cli/picker.js";

/** A terminal that records what was done to it, and lets the test type. */
class FakeInput extends EventEmitter {
  isTTY = true;
  isRaw = false;
  rawCalls: boolean[] = [];
  paused = true;
  refuseRaw = false;
  setRawMode(mode: boolean): this {
    if (this.refuseRaw) throw new Error("raw mode is not supported");
    this.rawCalls.push(mode);
    this.isRaw = mode;
    return this;
  }
  resume(): this { this.paused = false; return this; }
  pause(): this { this.paused = true; return this; }
  type(...keys: string[]): void { for (const k of keys) this.emit("data", Buffer.from(k, "utf8")); }
}

function fakeTerminal(): { t: PickerTerminal; input: FakeInput; out: string[] } {
  const input = new FakeInput();
  const out: string[] = [];
  return { t: { input, output: { isTTY: true, columns: 100, write: (s: string) => { out.push(s); return true; } } }, input, out };
}

const UP = "\u001b[A", DOWN = "\u001b[B", ENTER = "\r", SPACE = " ", CTRL_C = "\u0003";
const SPEC: PickSpec = {
  question: "Which fruit?",
  items: [{ label: "Apple" }, { label: "Banana", detail: "yellow" }, { label: "Cherry", aliases: ["c"] }],
};
const ENV = {};                                   // no CI, no TERM=dumb, no pin

/** Start a pick, then type into it once it has drawn. */
async function arrow<T>(start: (io: Parameters<typeof pickOne>[0]) => Promise<T>, keys: readonly string[], opts: { onInterrupt?: () => void } = {}) {
  const { t, input, out } = fakeTerminal();
  const printed: string[] = [];
  const asked: string[] = [];
  const p = start({
    prompt: async (q) => { asked.push(q); return ""; },
    print: (l) => printed.push(l),
    terminal: t,
    env: ENV,
    ...(opts.onInterrupt ? { onInterrupt: opts.onInterrupt } : {}),
  });
  await Promise.resolve();
  input.type(...keys);
  const result = await p;
  return { result, input, out: out.join(""), printed, asked };
}

describe("gov-work — the shared picker (F158, Q12 A): when arrows run", () => {
  const tty = fakeTerminal().t;
  it("runs in a real TTY with raw mode", () => {
    expect(arrowsAvailable(tty, {})).to.equal(true);
  });
  it("falls back to numbered: no terminal, piped stdin, CI, TERM=dumb, the pin, no raw mode", () => {
    expect(arrowsAvailable(undefined, {})).to.equal(false);
    expect(arrowsAvailable({ ...tty, input: Object.assign(new FakeInput(), { isTTY: false }) }, {})).to.equal(false);
    expect(arrowsAvailable({ ...tty, output: { isTTY: false, write: () => true } }, {})).to.equal(false);
    expect(arrowsAvailable(tty, { CI: "true" })).to.equal(false);
    expect(arrowsAvailable(tty, { CI: "1" })).to.equal(false);
    expect(arrowsAvailable(tty, { TERM: "dumb" })).to.equal(false);
    expect(arrowsAvailable(tty, { [PLAIN_PROMPTS_ENV]: "1" })).to.equal(false);
    const noRaw = { ...tty, input: { ...new FakeInput(), isTTY: true, setRawMode: undefined } } as unknown as PickerTerminal;
    expect(arrowsAvailable(noRaw, {})).to.equal(false);
  });
  it("CI=false and GOV_PLAIN_PROMPTS=0 do not turn arrows off", () => {
    expect(arrowsAvailable(tty, { CI: "false", [PLAIN_PROMPTS_ENV]: "0" })).to.equal(true);
  });
});

describe("gov-work — the shared picker: single-select with arrows", () => {
  it("Enter picks where the cursor is; ↓ moves it", async () => {
    const r = await arrow((io) => pickOne(io, SPEC), [DOWN, ENTER]);
    expect(r.result).to.equal(1);
    expect(r.asked, "no numbered prompt was asked").to.have.length(0);
    expect(r.out).to.contain(SINGLE_HINT);
    expect(r.out).to.contain("✓ Banana");
  });
  it("wraps around at both ends, and k/j move too", async () => {
    expect((await arrow((io) => pickOne(io, SPEC), [UP, ENTER])).result).to.equal(2);
    expect((await arrow((io) => pickOne(io, SPEC), [DOWN, DOWN, DOWN, ENTER])).result).to.equal(0);
    expect((await arrow((io) => pickOne(io, SPEC), ["j", "j", "k", ENTER])).result).to.equal(1);
  });
  it("a digit jumps to that number; the cursor starts at the default", async () => {
    expect((await arrow((io) => pickOne(io, SPEC), ["3", ENTER])).result).to.equal(2);
    expect((await arrow((io) => pickOne(io, { ...SPEC, defaultIndex: 1 }), [ENTER])).result).to.equal(1);
  });
  it("several keys in one chunk (a fast typist, a paste) are each read", async () => {
    expect((await arrow((io) => pickOne(io, SPEC), [DOWN + DOWN + ENTER])).result).to.equal(2);
  });
  it("Space does nothing in a single-select", async () => {
    expect((await arrow((io) => pickOne(io, SPEC), [SPACE, ENTER])).result).to.equal(0);
  });
  it("prints the question once, above the list, in both modes", async () => {
    const r = await arrow((io) => pickOne(io, SPEC), [ENTER]);
    expect(r.printed).to.include("Which fruit?");
  });
});

describe("gov-work — the shared picker: multi-select with arrows", () => {
  it("Space toggles, Enter submits — in list order", async () => {
    const r = await arrow((io) => pickMany(io, SPEC), [DOWN, DOWN, SPACE, UP, UP, SPACE, ENTER]);
    expect(r.result).to.deep.equal([0, 2]);
    expect(r.out).to.contain(MULTI_HINT);
    expect(r.out).to.contain("[x] Apple");
    expect(r.out).to.contain("✓ Apple, Cherry");
  });
  it("toggling twice unselects; Enter with nothing selected is an answer: none", async () => {
    const r = await arrow((io) => pickMany(io, SPEC), [SPACE, SPACE, ENTER]);
    expect(r.result).to.deep.equal([]);
    expect(r.out).to.contain("✓ (none)");
  });
});

describe("gov-work — the shared picker: the terminal is always handed back", () => {
  it("after a choice: raw mode off again, cursor shown, stdin paused, no listener left", async () => {
    const r = await arrow((io) => pickOne(io, SPEC), [ENTER]);
    expect(r.input.rawCalls).to.deep.equal([true, false]);
    expect(r.input.isRaw).to.equal(false);
    expect(r.out).to.contain("\u001b[?25l").and.contain("\u001b[?25h");
    expect(r.out.lastIndexOf("\u001b[?25h")).to.be.greaterThan(r.out.lastIndexOf("\u001b[?25l"));
    expect(r.input.paused).to.equal(true);
    expect(r.input.listenerCount("data")).to.equal(0);
  });
  it("Ctrl-C is no answer, and leaves raw mode off and the cursor shown", async () => {
    const r = await arrow((io) => pickOne(io, SPEC), [DOWN, CTRL_C], { onInterrupt: () => {} });
    expect(r.result, "no answer").to.equal(null);
    expect(r.input.isRaw).to.equal(false);
    expect(r.input.rawCalls.at(-1)).to.equal(false);
    expect(r.out).to.contain("\u001b[?25h");
  });
  it("Ctrl-C calls the interrupt exactly once, after raw mode is off", async () => {
    const { t, input } = fakeTerminal();
    const seen: boolean[] = [];
    const p = pickOne({ prompt: async () => "", print: () => {}, terminal: t, env: ENV, onInterrupt: () => seen.push(input.isRaw) }, SPEC);
    await Promise.resolve();
    input.type(CTRL_C, CTRL_C);
    expect(await p).to.equal(null);
    expect(seen).to.deep.equal([false]);
  });
  it("stdin closing mid-choice is no answer, and still restores", async () => {
    const { t, input } = fakeTerminal();
    const p = pickOne({ prompt: async () => "", print: () => {}, terminal: t, env: ENV }, SPEC);
    await Promise.resolve();
    input.emit("end");
    expect(await p).to.equal(null);
    expect(input.isRaw).to.equal(false);
  });
  it("a terminal that refuses raw mode gets the numbered prompt instead — never an error", async () => {
    const { t, input } = fakeTerminal();
    input.refuseRaw = true;
    const asked: string[] = [];
    const r = await pickOne({ prompt: async (q) => { asked.push(q); return "2"; }, print: () => {}, terminal: t, env: ENV }, SPEC);
    expect(r).to.equal(1);
    expect(asked[0]).to.contain("Choose [1/2/3]");
  });
});

describe("gov-work — the shared picker: the numbered form (today's prompt, unchanged)", () => {
  async function numbered(spec: PickSpec, answers: readonly string[], multi = false, env: Record<string, string> = {}) {
    const printed: string[] = []; const asked: string[] = []; let i = 0;
    const io = { prompt: async (q: string) => { asked.push(q); return answers[i++] ?? ""; }, print: (l: string) => printed.push(l), terminal: fakeTerminal().t, env };
    const result = multi ? await pickMany(io, spec) : await pickOne(io, spec);
    return { result, printed, asked };
  }
  it("CI keeps the numbered prompt even on a TTY", async () => {
    const r = await numbered(SPEC, ["2"], false, { CI: "true" });
    expect(r.result).to.equal(1);
    expect(r.asked[0]).to.equal("  Choose [1/2/3] : ");
    expect(r.printed.join("\n")).to.contain("     2) Banana").and.contain("yellow");
  });
  it("GOV_PLAIN_PROMPTS=1 forces it", async () => {
    expect((await numbered(SPEC, ["c"], false, { [PLAIN_PROMPTS_ENV]: "1" })).result, "an alias is an answer").to.equal(2);
  });
  it("re-asks on a wrong answer, saying what was wrong; bounded", async () => {
    const r = await numbered(SPEC, ["9", "", "1"], false, { CI: "1" });
    expect(r.result).to.equal(0);
    expect(r.printed.join("\n")).to.contain("'9' is not one of the numbers above.");
    expect((await numbered(SPEC, Array(20).fill("x"), false, { CI: "1" })).result).to.equal(null);
  });
  it("Enter takes the default and the label says which", async () => {
    const spec = { ...SPEC, defaultIndex: 0 };
    expect(numberedLabel(spec, false)).to.equal("  Choose [1/2/3] (Enter = 1, Apple) : ");
    expect((await numbered(spec, [""], false, { CI: "1" })).result).to.equal(0);
  });
  it("multi takes `1,3` — and spaces, repeats, aliases; Enter is none", () => {
    expect(parseNumbered(SPEC, "1,3", true)).to.deep.equal({ ok: true, picks: [0, 2] });
    expect(parseNumbered(SPEC, "3 1 3", true)).to.deep.equal({ ok: true, picks: [0, 2] });
    expect(parseNumbered(SPEC, "c, 2", true)).to.deep.equal({ ok: true, picks: [1, 2] });
    expect(parseNumbered(SPEC, "", true)).to.deep.equal({ ok: true, picks: [] });
    expect(parseNumbered(SPEC, "1,7", true)).to.deep.equal({ ok: false, message: "'7' is not one of the numbers above." });
    expect(numberedLabel(SPEC, true)).to.contain("Choose [1/2/3]").and.contain("e.g. 1,3").and.contain("Enter = none");
  });
  it("keeps stable numbers that are not positions", () => {
    const spec: PickSpec = { items: [{ label: "B", number: 2 }, { label: "D", number: 4 }] };
    expect(numberedLabel(spec, true)).to.contain("[2/4]");
    expect(parseNumbered(spec, "4", false)).to.deep.equal({ ok: true, picks: [1] });
    expect(parseNumbered(spec, "1", false).ok).to.equal(false);
  });
});

describe("gov-work — the shared picker: keys and frames", () => {
  it("reads arrows in both encodings, Enter as CR or LF, Ctrl-C as an interrupt, Ctrl-D as no answer", () => {
    expect(readKeys("\u001b[A\u001bOB\r\n \u0003\u0004")).to.deep.equal(["up", "down", "enter", "enter", "space", "interrupt", "eof"]);
  });
  it("drops an unknown escape sequence rather than reading it as keys", () => {
    expect(readKeys("\u001b[5~\r")).to.deep.equal(["enter"]);
  });
  it("a frame marks the cursor and the selection, ends with the hint, and fits the width", () => {
    const f = frame({ items: [{ label: "A".repeat(200) }, { label: "B" }] }, true, 1, new Set([1]), 40);
    expect(f[1]).to.contain("❯ [x] B");
    expect(f.at(-1)).to.contain(MULTI_HINT);
    for (const l of f) expect(l.length).to.be.at.most(39);
  });
});

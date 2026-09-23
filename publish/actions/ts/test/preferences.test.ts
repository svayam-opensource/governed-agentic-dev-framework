// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * ONE PLACE FOR A PERSON'S PREFERENCES (Policy Owner, 2026-09-22/23).
 *
 * The properties worth holding: every key has a default that is right for most people; a bad value or an
 * unknown key is REPORTED and ignored rather than stopping a command; and what is printed says whether a value
 * is yours or gov's, because JSON cannot carry a comment.
 */
import { expect } from "chai";
import {
  PREFS, coerce, formatPreferences, numberPref, boolPref, stringPref, parsePreferences,
  renderPreferences, specFor, starterPreferences, unknownKeys, validate, valueOf, PREFERENCES_VERSION,
} from "../src/preferences.js";

describe("preferences — the settings themselves", () => {
  it("every setting has a default, a rule, and one line a person can read", () => {
    for (const s of PREFS) {
      expect(s.what, `${s.key} says what it does`).to.have.length.greaterThan(10);
      expect(validate(s, s.def), `${s.key}'s own default is valid`).to.equal(null);
      if (s.kind === "enum") expect(s.values, `${s.key} lists its values`).to.have.length.greaterThan(1);
    }
  });

  it("a fresh file is just the version — every value is gov's until someone says otherwise", () => {
    const starter = starterPreferences();
    expect(JSON.parse(starter)).to.deep.equal({ version: PREFERENCES_VERSION });
    const p = parsePreferences(starter);
    expect(p.problems).to.deep.equal([]);
    expect(numberPref(p, "work.picker.pageSize")).to.equal(15);
    expect(boolPref(p, "work.picker.localFirst")).to.equal(true);
    expect(stringPref(p, "agent.default"), "nobody's agent by default").to.equal(null);
  });
});

describe("preferences — reading a person's file", () => {
  it("takes the values they set, and leaves the rest at the default", () => {
    const p = parsePreferences(JSON.stringify({ version: 1, work: { picker: { pageSize: 25 } }, display: { color: "never" } }));
    expect(p.problems).to.deep.equal([]);
    expect(numberPref(p, "work.picker.pageSize")).to.equal(25);
    expect(stringPref(p, "display.color")).to.equal("never");
    expect(numberPref(p, "work.picker.searchThreshold"), "untouched keys keep the default").to.equal(30);
  });

  // A broken preferences file must not be able to break `gov doctor` — which is how you would find out.
  it("unparseable JSON costs a warning, not a command", () => {
    const p = parsePreferences("{ this is not json");
    expect(p.problems[0]).to.contain("not valid JSON");
    expect(numberPref(p, "work.picker.pageSize"), "and gov carries on with the defaults").to.equal(15);
  });

  it("a value out of range is reported and ignored", () => {
    const p = parsePreferences(JSON.stringify({ work: { picker: { pageSize: 500 } }, logs: { keepDays: 0 } }));
    expect(p.problems.join(" ")).to.contain("500 is above 50").and.contain("0 is below 1");
    expect(numberPref(p, "work.picker.pageSize")).to.equal(15);
    expect(numberPref(p, "logs.keepDays")).to.equal(14);
  });

  it("a value of the wrong type is reported and ignored", () => {
    const p = parsePreferences(JSON.stringify({ work: { picker: { localFirst: "yes please" } }, display: { color: "chartreuse" } }));
    expect(p.problems.join(" ")).to.contain("expected true or false").and.contain("auto · always · never");
    expect(boolPref(p, "work.picker.localFirst")).to.equal(true);
  });

  it("a key gov does not know is named, not silently dropped", () => {
    const p = parsePreferences(JSON.stringify({ work: { picker: { pageSize: 20, colour: "blue" } }, wat: 1 }));
    expect(p.problems.join(" ")).to.contain("work.picker.colour").and.contain("wat");
    expect(numberPref(p, "work.picker.pageSize"), "and the good keys still apply").to.equal(20);
    expect(unknownKeys({ version: 1, agent: { default: "x" } }), "version and known keys are not unknown").to.deep.equal([]);
  });
});

describe("preferences — changing one", () => {
  it("turns what a person typed into the value the setting wants", () => {
    expect(coerce(specFor("work.picker.pageSize")!, " 25 ")).to.deep.equal({ value: 25 });
    expect(coerce(specFor("work.picker.localFirst")!, "no")).to.deep.equal({ value: false });
    expect(coerce(specFor("display.color")!, "never")).to.deep.equal({ value: "never" });
    expect(coerce(specFor("agent.default")!, "null"), "a preference can be unset").to.deep.equal({ value: null });
  });

  it("refuses what the setting does not allow, and says what it wanted", () => {
    expect(coerce(specFor("work.picker.pageSize")!, "500")).to.have.property("error").that.contains("above 50");
    expect(coerce(specFor("display.color")!, "chartreuse")).to.have.property("error").that.contains("auto · always · never");
    expect(coerce(specFor("work.picker.localFirst")!, "maybe")).to.have.property("error").that.contains("true or false");
  });

  it("writes back only what the person set, nested, with the version", () => {
    const values = new Map<string, string | number | boolean | null>([["work.picker.pageSize", 25], ["display.color", "never"]]);
    expect(JSON.parse(renderPreferences(values))).to.deep.equal({ version: 1, work: { picker: { pageSize: 25 } }, display: { color: "never" } });
  });

  it("a round trip keeps the value and adds no problems", () => {
    const p = parsePreferences(renderPreferences(new Map([["logs.keepDays", 30]])));
    expect(p.problems).to.deep.equal([]);
    expect(valueOf(p, "logs.keepDays")).to.equal(30);
  });
});

describe("preferences — what `gov preferences` prints", () => {
  it("says of each value whether it is yours or gov's, and what it does", () => {
    const p = parsePreferences(JSON.stringify({ work: { picker: { pageSize: 25 } } }));
    const text = formatPreferences(p, "/w/preferences/rk/preferences.json").join("\n");
    expect(text).to.contain("/w/preferences/rk/preferences.json");
    expect(text).to.match(/work\.picker\.pageSize\s+25\s+\(yours\)/);
    expect(text).to.match(/logs\.keepDays\s+14\s+\(default\)/);
    expect(text, "and how to change one").to.contain("gov preferences set");
  });

  it("shows the problems with the file, so a mistake is visible where it is read", () => {
    const text = formatPreferences(parsePreferences('{ "logs": { "keepDays": 0 } }'), "/f").join("\n");
    expect(text).to.contain("Problems in the file").and.contain("below 1");
  });
});

// Policy Owner, 2026-09-22: one folder per person. The markdown their AGENT reads moves in beside the JSON
// the CLI reads — moved, never copied, because two copies of the same prose is how one of them goes stale.
describe("the person's notes join their folder", () => {
  it("moves preferences/<login>.md into preferences/<login>/, once, and says so", async () => {
    const fs = await import("node:fs"); const os = await import("node:os"); const path = await import("node:path");
    const { movePersonalMarkdown } = await import("../src/cli/preferences-io.js");
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "gov-prefs-"));
    try {
      fs.mkdirSync(path.join(root, "preferences"), { recursive: true });
      fs.writeFileSync(path.join(root, "preferences", "rk.md"), "# how I like to work\n");
      const said: string[] = [];
      movePersonalMarkdown(root, "rk", (from, to) => said.push(`${from} → ${to}`));

      expect(fs.existsSync(path.join(root, "preferences", "rk", "rk.md")), "it is in the folder").to.equal(true);
      expect(fs.existsSync(path.join(root, "preferences", "rk.md")), "and not left behind as a second copy").to.equal(false);
      expect(said, "and the person is told").to.have.length(1);
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });

  it("never overwrites notes already in the folder, and is silent when there is nothing to move", async () => {
    const fs = await import("node:fs"); const os = await import("node:os"); const path = await import("node:path");
    const { movePersonalMarkdown } = await import("../src/cli/preferences-io.js");
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "gov-prefs-"));
    try {
      fs.mkdirSync(path.join(root, "preferences", "rk"), { recursive: true });
      fs.writeFileSync(path.join(root, "preferences", "rk.md"), "older\n");
      fs.writeFileSync(path.join(root, "preferences", "rk", "rk.md"), "the one in the folder\n");
      const said: string[] = [];
      movePersonalMarkdown(root, "rk", () => said.push("moved"));
      expect(fs.readFileSync(path.join(root, "preferences", "rk", "rk.md"), "utf8")).to.equal("the one in the folder\n");
      expect(said).to.deep.equal([]);

      movePersonalMarkdown(root, "nobody", () => said.push("moved"));
      expect(said, "nothing to move is not an event").to.deep.equal([]);
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });
});

// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * THE PICKER'S ARITHMETIC AND VOCABULARY, WITHOUT A TERMINAL.
 *
 * Every function here is pure, which is the point: the last version of this list paginated 11, then 1, then 7
 * on a real walk, and no unit test could have caught it because the paging, the filtering and the screen were
 * one loop inside a prompt. These are separate now, so the arithmetic is asserted directly, with a list long
 * enough to page more than twice.
 */
import { expect } from "chai";
import {
  DEFAULT_PAGE_SIZE, DEFAULT_SEARCH_THRESHOLD, MIN_PAGE_SIZE, fillPage, formatLevel, githubUnreachableLines, leadWithSearch,
  matchProjects, pageOf, pickerFooter, pickerSettings, pickerSettingsFromPreferences, rankProjects,
  resolvePickerInput, type LevelView, type PickerRow,
} from "../../src/cli/project-picker.js";
import { isRateLimited } from "../../src/lifecycle/project-list.js";
import { parsePreferences } from "../../src/preferences.js";

const ids = (n: number, from = 100): { projectId: string; title: string }[] =>
  Array.from({ length: n }, (_, i) => ({ projectId: `PRJ-${from - i}-p${from - i}`, title: `Project ${from - i}` }));

describe("picker — paging that cannot lie", () => {
  it("pages a list of 37 as 15 · 15 · 7, and says which page it is on", () => {
    // THE REGRESSION, AS ARITHMETIC. Three pages is the minimum that shows a wrong `nextOffset`: with two,
    // an off-by-one in the resume point is indistinguishable from the end of the list.
    const items = ids(37);
    const first = pageOf(items, 15, 0);
    expect(first.items).to.have.length(15);
    expect([first.page, first.pages]).to.deep.equal([1, 3]);
    expect(first.more).to.equal(true);

    const second = pageOf(items, 15, first.nextOffset);
    expect(second.items).to.have.length(15);
    expect([second.page, second.pages]).to.deep.equal([2, 3]);
    expect(second.items[0]!.projectId, "resumes where the first page stopped — nothing skipped or repeated")
      .to.equal(items[15]!.projectId);

    const third = pageOf(items, 15, second.nextOffset);
    expect(third.items).to.have.length(7);
    expect([third.page, third.pages]).to.deep.equal([3, 3]);
    expect(third.more, "the last page says there is no more").to.equal(false);
    expect(third.items[6]!.projectId).to.equal(items[36]!.projectId);
  });

  it("every page is FULL except the last, whatever the page size", () => {
    for (const size of [5, 7, 15, 20]) {
      const items = ids(37);
      const shown: number[] = [];
      for (let off = 0; ;) {
        const p = pageOf(items, size, off);
        shown.push(p.items.length);
        if (!p.more) break;
        off = p.nextOffset;
      }
      expect(shown.slice(0, -1).every((n) => n === size), `size ${size} → ${shown.join("/")}`).to.equal(true);
      expect(shown.reduce((a, b) => a + b, 0), "and every item was shown exactly once").to.equal(37);
    }
  });

  it("THE FILTER RUNS FIRST — a search of 37 down to 20 pages as 15 · 5, not 15 · 5 · … of stragglers", () => {
    // This is the defect's shape: page-then-filter gave pages of whatever survived. `pageOf` can only see the
    // list it is handed, so a caller that filters first cannot reproduce it — which is the whole reason the
    // filtering lives outside this function.
    const items = ids(37);
    const filtered = items.filter((_, i) => i < 20);
    const a = pageOf(filtered, 15, 0);
    const b = pageOf(filtered, 15, a.nextOffset);
    expect([a.items.length, b.items.length]).to.deep.equal([15, 5]);
    expect(b.more).to.equal(false);
  });

  it("an offset past the end is an empty last page, not a crash or a wrap", () => {
    const p = pageOf(ids(3), 15, 99);
    expect(p.items).to.deep.equal([]);
    expect(p.more).to.equal(false);
  });

  it("fillPage fills from a predicate — 5 at a time out of every 4th item, resuming correctly", () => {
    // "You could start" costs a gh call per candidate, so its page is filled by SCANNING: the page size is
    // still what is SHOWN, and `scanned` is what it cost.
    const items = ids(40);
    const writable = (p: { projectId: string }): boolean => Number(p.projectId.split("-")[1]) % 4 === 0;
    const first = fillPage(items, writable, 5, 0);
    expect(first.items).to.have.length(5);
    expect(first.scanned, "it looked at exactly as many as it took to fill the page").to.equal(17);
    expect(first.more).to.equal(true);

    const second = fillPage(items, writable, 5, first.nextOffset);
    expect(second.items).to.have.length(5);
    expect(second.items[0]!.projectId).to.not.equal(first.items[4]!.projectId);

    const last = fillPage(items, writable, 5, second.nextOffset);
    expect(last.items.length, "10 writable of 40 → the third page is empty and final").to.equal(0);
    expect(last.more).to.equal(false);
  });

  it("fillPage never calls the predicate for an item a search already ruled out", () => {
    // The point of filtering before checking: a search must save GitHub calls, not just screen space.
    const items = ids(40);
    const asked: string[] = [];
    const filtered = items.filter((i) => i.projectId.includes("PRJ-9"));
    fillPage(filtered, (p) => { asked.push(p.projectId); return true; }, 15, 0);
    expect(asked.length, "only the matches were checked, not the org").to.equal(filtered.length);
    expect(asked.every((id) => id.includes("PRJ-9"))).to.equal(true);
  });
});

describe("picker — /text ranking", () => {
  const items = [
    { projectId: "PRJ-120-saas-portal", title: "SaaS Portal" },
    { projectId: "PRJ-119-billing", title: "Billing and invoices" },
    { projectId: "PRJ-118-infra", title: "Customer portal infrastructure" },
    { projectId: "PRJ-117-docs", title: "Docs" },
  ];

  it("matches the project id and the board title, case-insensitively", () => {
    expect(rankProjects(items, "portal").map((i) => i.projectId))
      .to.deep.equal(["PRJ-120-saas-portal", "PRJ-118-infra"]);
    expect(rankProjects(items, "BILLING").map((i) => i.projectId)).to.deep.equal(["PRJ-119-billing"]);
  });

  it("a match in the ID outranks a match in the title — the id is what a person half-remembers", () => {
    expect(rankProjects(items, "portal")[0]!.projectId).to.equal("PRJ-120-saas-portal");
  });

  it("EVERY term must appear — two words do not return everything with either", () => {
    expect(rankProjects(items, "customer portal").map((i) => i.projectId)).to.deep.equal(["PRJ-118-infra"]);
    expect(rankProjects(items, "portal zzz")).to.deep.equal([]);
  });

  it("nothing matching is an empty list, and an empty query is everything, in the order it arrived", () => {
    expect(rankProjects(items, "zzznothing")).to.deep.equal([]);
    expect(rankProjects(items, "   ").map((i) => i.projectId)).to.deep.equal(items.map((i) => i.projectId));
  });

  it("whatever `--project` matches, the menu matches too — and ranks it first", () => {
    // One idea of "matches" (design §3.4). The regex form is the command line's; the menu adds the title.
    const pattern = "1(19|18)";
    const cli = matchProjects(items, pattern).map((i) => i.projectId);
    const menu = rankProjects(items, pattern).map((i) => i.projectId);
    expect(cli).to.deep.equal(["PRJ-119-billing", "PRJ-118-infra"]);
    expect(menu.slice(0, cli.length)).to.deep.equal(cli);
  });

  it("an invalid regex is matched literally, in both — nobody gets a lecture about escaping", () => {
    const odd = [{ projectId: "PRJ-9-portal(v2", title: "Portal v2" }];
    expect(matchProjects(odd, "portal(v2").map((i) => i.projectId)).to.deep.equal(["PRJ-9-portal(v2"]);
    expect(rankProjects(odd, "portal(v2").map((i) => i.projectId)).to.deep.equal(["PRJ-9-portal(v2"]);
  });
});

describe("picker — leading with search past a threshold", () => {
  it("30 is a list; 31 leads with search (the design's threshold, and the shipped default)", () => {
    expect(DEFAULT_SEARCH_THRESHOLD).to.equal(30);
    expect(leadWithSearch(30, 30)).to.equal(false);
    expect(leadWithSearch(31, 30)).to.equal(true);
    expect(leadWithSearch(42, 30)).to.equal(true);
  });

  it("an already-filtered level never leads with search again — you have just searched", () => {
    expect(leadWithSearch(400, 30, true)).to.equal(false);
  });

  it("a threshold of 0 is an answer, not a disabled feature: always ask for a pattern", () => {
    expect(leadWithSearch(1, 0)).to.equal(true);
    expect(leadWithSearch(0, 0), "…but an empty level has nothing to search").to.equal(false);
  });
});

describe("picker — one keystroke, one meaning", () => {
  it("a number always selects", () => {
    expect(resolvePickerInput("3")).to.deep.equal({ kind: "pick", n: 3 });
    expect(resolvePickerInput(" 12 ", { more: true })).to.deep.equal({ kind: "pick", n: 12 });
  });

  it("/text searches, and a bare / clears the filter", () => {
    expect(resolvePickerInput("/billing")).to.deep.equal({ kind: "search", query: "billing" });
    expect(resolvePickerInput("/ customer portal ")).to.deep.equal({ kind: "search", query: "customer portal" });
    expect(resolvePickerInput("/")).to.deep.equal({ kind: "clear" });
    expect(resolvePickerInput("/121"), "a number after / is a search, not a pick").to.deep.equal({ kind: "search", query: "121" });
  });

  it("0 and Enter go back one level — the menu's stack rule", () => {
    expect(resolvePickerInput("0")).to.deep.equal({ kind: "back" });
    expect(resolvePickerInput("")).to.deep.equal({ kind: "back" });
  });

  it("m · g · s only where the level offers them — an offer that does nothing is worse than none", () => {
    expect(resolvePickerInput("m", { more: true })).to.deep.equal({ kind: "more" });
    expect(resolvePickerInput("m", { more: false })).to.deep.equal({ kind: "unknown" });
    expect(resolvePickerInput("G", { mine: true })).to.deep.equal({ kind: "level", to: "mine" });
    expect(resolvePickerInput("g")).to.deep.equal({ kind: "unknown" });
    expect(resolvePickerInput("s", { startable: true })).to.deep.equal({ kind: "level", to: "startable" });
    expect(resolvePickerInput("s")).to.deep.equal({ kind: "unknown" });
    expect(resolvePickerInput("wat")).to.deep.equal({ kind: "unknown" });
  });
});

describe("picker — what the level says", () => {
  const rows = (n: number): PickerRow[] => Array.from({ length: n }, (_, i) => ({ projectId: `PRJ-${9 - i}-p`, note: "(active)" }));
  const view = (over: Partial<LevelView> = {}): LevelView => ({
    level: "startable", rows: rows(3), total: 3, page: 1, pages: 1, more: false, query: null, searchFirst: false,
    keys: {}, ...over,
  });

  it("names the level, numbers the rows from 1, and offers only the keys that apply", () => {
    const out = formatLevel(view({ level: "mine", keys: { startable: true } })).join("\n");
    expect(out).to.contain("Yours on GitHub");
    expect(out).to.contain(" 1) PRJ-9-p");
    expect(out).to.contain("s) you could start");
    expect(out).to.not.contain("m) more");
    expect(out).to.not.contain("g) yours on GitHub");
    expect(out).to.contain("0) back");
  });

  it("past the threshold it asks for a pattern and lists nothing — paging is offered second", () => {
    const out = formatLevel(view({ rows: [], total: 42, searchFirst: true, more: true, keys: { more: true } })).join("\n");
    expect(out).to.contain("42 boards nobody has started yet. Type part of a name to search (/), or m to page through them.");
    expect(out, "no rows were listed — not one project id is on screen").to.not.contain("PRJ-");
    expect(out).to.contain("m) more");
  });

  it("a filtered level says how many matched, and a miss stays open rather than dead-ending", () => {
    expect(formatLevel(view({ query: "portal", total: 2, rows: rows(2) })).join("\n")).to.contain("2 matches 'portal'");
    const miss = formatLevel(view({ query: "portal", total: 0, rows: [] })).join("\n");
    expect(miss).to.contain("nothing matches 'portal'");
    expect(miss).to.contain("/ clears it");
  });

  it("ONE match is shown with a confirm line — never opened unasked", () => {
    const out = formatLevel(view({ query: "portal", total: 1, rows: rows(1) })).join("\n");
    expect(out).to.contain("press 1 to open it");
  });

  it("the page counter appears only when there is more than one page", () => {
    expect(formatLevel(view({ page: 2, pages: 3 })).join("\n")).to.contain("page 2 of 3");
    expect(formatLevel(view()).join("\n")).to.not.contain("page 1 of 1");
  });

  it("the footer offers `/` to clear only when something is filtered", () => {
    expect(pickerFooter(view()).join("\n")).to.contain("/text) search this list");
    expect(pickerFooter(view({ query: "x" })).join("\n")).to.contain("show them all");
  });
});

describe("picker — GitHub throttling is an answer, not an exception", () => {
  it("recognises a primary limit, a secondary one, and a 429 — and does not cry wolf", () => {
    expect(isRateLimited("API rate limit exceeded for user ID 42")).to.equal(true);
    expect(isRateLimited("You have exceeded a secondary rate limit")).to.equal(true);
    expect(isRateLimited("HTTP 429: too many requests")).to.equal(true);
    expect(isRateLimited("was submitted too quickly")).to.equal(true);
    expect(isRateLimited("Command failed: gh project list … EOF")).to.equal(false);
    expect(isRateLimited(null)).to.equal(false);
  });

  it("a rate limit names the limit and the reset, never `gh auth status` — nothing is broken", () => {
    const out = githubUnreachableLines("API rate limit exceeded", 3).join("\n");
    expect(out).to.contain("rate-limiting");
    expect(out).to.contain("gh api rate_limit");
    expect(out).to.not.contain("gh auth status");
    expect(out, "and it hands back the list that costs nothing").to.contain("3 projects already on this machine");
  });

  it("any other failure keeps the older, right advice — and never says 'no projects'", () => {
    const out = githubUnreachableLines("Command failed: gh project list … EOF", 1).join("\n");
    expect(out).to.contain("Could not reach GitHub");
    expect(out).to.contain("gh auth status");
    expect(out).to.contain("is the project already on this machine");
  });

  it("with nothing local it says so, rather than implying an offline list exists", () => {
    expect(githubUnreachableLines("API rate limit exceeded", 0).join("\n")).to.contain("nothing to offer offline");
  });
});

describe("picker — the work.picker.* settings, in force", () => {
  it("reads all four out of a preferences file", () => {
    const prefs = parsePreferences(JSON.stringify({
      version: 1, work: { picker: { pageSize: 25, localFirst: false, localOrder: "number", searchThreshold: 5 } },
    }));
    expect(prefs.problems).to.deep.equal([]);
    expect(pickerSettingsFromPreferences(prefs)).to.deep.equal({ pageSize: 25, localFirst: false, localOrder: "number", searchThreshold: 5 });
  });

  it("and defaults every one of them for somebody who has never opened the file", () => {
    expect(pickerSettingsFromPreferences(parsePreferences(null)))
      .to.deep.equal({ pageSize: DEFAULT_PAGE_SIZE, localFirst: true, localOrder: "last-used", searchThreshold: DEFAULT_SEARCH_THRESHOLD });
  });

  it("clamps a page size that would make the picker useless", () => {
    expect(pickerSettings({ pageSize: MIN_PAGE_SIZE - 1 }).pageSize, "below the floor → the default").to.equal(DEFAULT_PAGE_SIZE);
    expect(pickerSettings({ pageSize: MIN_PAGE_SIZE }).pageSize, "and the floor itself is allowed — it is what the prefs file permits").to.equal(MIN_PAGE_SIZE);
    expect(pickerSettings({ pageSize: 0 }).pageSize).to.equal(DEFAULT_PAGE_SIZE);
    expect(pickerSettings({ pageSize: 20 }).pageSize).to.equal(20);
    expect(pickerSettings({ searchThreshold: -1 }).searchThreshold).to.equal(DEFAULT_SEARCH_THRESHOLD);
    expect(pickerSettings({ localOrder: "wat" }).localOrder, "an unknown order is the default one").to.equal("last-used");
  });
});

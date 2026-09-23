// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * CLI HELP — one spec per command, four surfaces (Policy Owner, 2026-09-22/23).
 *
 * What a walk found: help lived in three hand-kept tables no parser read — 13 of ~25 commands had a
 * description, six a usage line, none an example — and `gov merge -h` ran a merge. The tests that matter are
 * therefore about COVERAGE and DRIFT as much as about wording: every command gov dispatches must have a page,
 * and every page must carry the parts the Policy Owner asked for.
 */
import { expect } from "chai";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { COMMAND_SPECS, specOf } from "../../src/cli/help-spec.js";
import { commandPage, didYouMean, helpFor, helpJson, overview, shortPage, TOPICS, topicPage } from "../../src/cli/help-render.js";
import { helpRequest } from "../../src/cli/help-request.js";

const srcDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../src");

describe("help — every command gov has, has a page", () => {
  // THE DRIFT GUARD. A verb added to the dispatcher without a spec has no help at all, which is how the old
  // tables came to cover half the commands. Read from the source, so adding a command fails here.
  it("every verb the dispatcher accepts has a spec", () => {
    const dispatch = fs.readFileSync(path.join(srcDir, "cli/dispatch.ts"), "utf8");
    const main = fs.readFileSync(path.join(srcDir, "cli/main.ts"), "utf8");
    const verbs = new Set<string>();
    for (const m of dispatch.matchAll(/^\s{4}case "([a-z-]+)":/gm)) verbs.add(m[1]!);
    for (const m of main.matchAll(/parsed\.command === "([a-z-]+)"/g)) verbs.add(m[1]!);
    // `add`/`use`/`remove` are org's subcommands, `prefs` is an alias, `setup`/`work` are routed in bin.ts.
    for (const alias of ["add", "use", "remove", "prefs"]) verbs.delete(alias);
    const missing = [...verbs].filter((v) => !specOf(v));
    expect(missing, "commands with no help page").to.deep.equal([]);
  });

  it("every spec carries what a governed reader needs", () => {
    for (const s of COMMAND_SPECS) {
      expect(s.summary, `${s.name} says what it does`).to.have.length.greaterThan(10);
      expect(s.examples, `${s.name} has an example — the most-read line of any help page`).to.have.length.greaterThan(0);
      for (const e of s.examples) expect(e, `${s.name}'s examples are commands`).to.match(/^gov /);
      expect(s.changes, `${s.name} says what it CHANGES`).to.be.a("string");
      expect(s.exit, `${s.name} says what its exit codes mean`).to.not.equal(undefined);
    }
  });

  it("the audiences are the three the Policy Owner named", () => {
    expect([...new Set(COMMAND_SPECS.map((s) => s.audience))].sort()).to.deep.equal(["agent", "maintainer", "you"]);
  });
});

describe("help — the overview", () => {
  it("groups by who runs it, and hides the commands for building gov itself", () => {
    const text = overview().join("\n");
    expect(text).to.contain("Your commands").and.contain("Your agent runs these");
    expect(text, "an adopter never needs publish").to.not.contain("Building gov itself");
    expect(text).to.not.match(/^\s+publish\s/m);
    expect(text, "and says how to see them").to.contain("gov help --all");
  });

  it("--all includes them", () => {
    const text = overview(true).join("\n");
    expect(text).to.contain("Building gov itself").and.match(/^\s+publish\s/m);
  });

  it("points at both kinds of page", () => {
    expect(overview().join("\n")).to.contain("gov help <command>").and.contain("gov help <topic>");
  });
});

describe("help — a command's page", () => {
  it("is in one order, always: usage, where, arguments, flags, examples, changes, exit, see also", () => {
    const page = commandPage(specOf("task")!).join("\n");
    const order = ["USAGE", "WHERE", "ARGUMENTS", "EXAMPLES", "CHANGES", "EXIT", "SEE ALSO"];
    let at = -1;
    for (const label of order) {
      const next = page.indexOf(label);
      expect(next, `${label} is present`).to.be.greaterThan(-1);
      expect(next, `${label} comes after the one before it`).to.be.greaterThan(at);
      at = next;
    }
  });

  it("says what the command changes, in words about branches and boards", () => {
    expect(commandPage(specOf("task")!).join("\n")).to.contain("ISSUE-").and.contain("assigns");
    expect(commandPage(specOf("doctor")!).join("\n"), "and says when it changes nothing").to.contain("nothing");
  });

  it("gives one line per exit code, even when a command adds a nuance to one", () => {
    const exitLines = commandPage(specOf("merge")!).join("\n").split("\n").filter((l) => /^\s+\d /.test(l) || l.includes("EXIT"));
    const ones = exitLines.filter((l) => /(^|\s)1 /.test(l));
    expect(ones, "code 1 is explained once, not twice").to.have.length(1);
    expect(ones[0]).to.contain("test-merge gate");
  });

  it("-h is the short form: usage and an example, and where the rest is", () => {
    const short = shortPage(specOf("merge")!).join("\n");
    expect(short).to.contain("usage: gov merge").and.contain("gov help merge");
    expect(short, "the long page's fields are not in it").to.not.contain("CHANGES");
  });
});

describe("help — topics, for the concepts commands assume", () => {
  it("answers about projects, tasks, orgs, context and preferences", () => {
    expect(TOPICS.map((t) => t.name)).to.deep.equal(["projects", "tasks", "orgs", "context", "preferences"]);
    for (const t of TOPICS) expect(topicPage(t.name), `${t.name} renders`).to.not.equal(null);
  });

  it("a topic is reachable by the same route as a command", () => {
    expect(helpFor("context")!.join("\n")).to.contain("PROJECT").and.contain("GOVERNED").and.contain("NONE");
    expect(helpFor("nonsense")).to.equal(null);
  });
});

describe("help — for an agent", () => {
  it("--json is the specs, parseable, with every command and topic", () => {
    const doc = JSON.parse(helpJson()) as { version: number; commands: { name: string; exit?: unknown[] }[]; topics: string[] };
    expect(doc.version).to.equal(1);
    expect(doc.commands.map((c) => c.name)).to.include.members(["work", "task", "merge", "publish"]);
    expect(doc.commands.find((c) => c.name === "task")!.exit, "an agent branches on these").to.not.equal(undefined);
    expect(doc.topics).to.include("context");
  });
});

describe("help — asking for it", () => {
  it("-h is short, --help is long, and both work after a command", () => {
    expect(helpRequest(["merge", "-h"])).to.deep.equal({ command: "merge", short: true });
    expect(helpRequest(["merge", "--help"])).to.deep.equal({ command: "merge" });
  });

  it("--all and --json travel with either", () => {
    expect(helpRequest(["help", "--all"])).to.deep.equal({ all: true });
    expect(helpRequest(["--help", "--json"])).to.deep.equal({ json: true });
    expect(helpRequest(["help", "task", "--json"])).to.deep.equal({ command: "task", json: true });
  });

  it("suggests the command that was meant, including a transposed one", () => {
    expect(didYouMean("tsak")).to.include("task");
    expect(didYouMean("wrk")).to.include("work");
    expect(didYouMean("prefer")).to.include("preferences");
    expect(didYouMean("zzzzzz"), "and suggests nothing when nothing is close").to.deep.equal([]);
  });
});

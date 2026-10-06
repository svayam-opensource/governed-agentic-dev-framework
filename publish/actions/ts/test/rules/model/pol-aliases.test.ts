// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
//
// POL → GOV ALIASES (rule-model-design.md Q21; W3). The pure loader and resolver, then the shipped file itself:
// every POL number the repository cites resolves, and every GOV-FRM target is a row rules.yaml really has.
import { expect } from "chai";
import { readFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import * as path from "node:path";
import {
  parsePolAliases, resolvePol, polBase, aliasTargets, countAliases, POL_ALIASES_PATH, ORG_PENDING,
} from "../../../src/rules/model/pol-aliases.js";
import { parseRuleStore } from "../../../src/rules/model/rule-row.js";
import { RULE_STORE_PATHS } from "../../../src/rules/model/store-io.js";

/** Built at run time so the repository-wide guard does not see it as a citation. */
const UNKNOWN_POL = ["POL", "777"].join("-");
const CONTENT = path.join(import.meta.dirname, "..", "..", "..", "..", "..", "content");
const REPO = path.join(CONTENT, "..", "..");

const SAMPLE = `
aliases:
  POL-012: GOV-FRM-012
  POL-013: { folded: GOV-FRM-012 }
  POL-044: { gov: GOV-FRM-044, also: [GOV-FRM-451] }
  POL-028: { dropped: "a definition, with no action in it" }
  POL-210: { org: "${ORG_PENDING}" }
  POL-040a: { gov: GOV-FRM-447 }
`;

describe("pol-aliases — the loader", () => {
  it("parses each of the five shapes", () => {
    const { aliases, errors } = parsePolAliases(SAMPLE);
    expect(errors).to.deep.equal([]);
    expect(aliases.get("POL-012")).to.deep.equal({ kind: "gov", gov: "GOV-FRM-012", also: [] });
    expect(aliases.get("POL-013")).to.deep.equal({ kind: "folded", into: "GOV-FRM-012" });
    expect(aliases.get("POL-044")).to.deep.equal({ kind: "gov", gov: "GOV-FRM-044", also: ["GOV-FRM-451"] });
    expect(aliases.get("POL-028")).to.deep.equal({ kind: "dropped", reason: "a definition, with no action in it" });
    expect(aliases.get("POL-210")).to.deep.equal({ kind: "org", note: ORG_PENDING });
  });

  it("reports, rather than skips, a malformed entry — a silently missing alias is a dead citation", () => {
    const { aliases, errors } = parsePolAliases(`
aliases:
  POL-1: GOV-FRM-001
  POL-002: POL-003
  POL-004: { folded: nope }
  POL-005: { dropped: "" }
  POL-006: { gov: GOV-FRM-006, folded: GOV-FRM-007 }
  POL-007: { mystery: x }
  POL-008: { gov: GOV-FRM-008, also: [bad] }
`);
    expect(aliases.size).to.equal(0);
    expect(errors).to.have.lengthOf(7);
    expect(errors.join("\n")).to.match(/POL-1\b.*not a POL id/);
  });

  it("refuses a file with no aliases map, and YAML that does not parse", () => {
    expect(parsePolAliases("- a\n- b\n").errors[0]).to.match(/aliases/);
    expect(parsePolAliases("aliases: [").errors[0]).to.match(/YAML/);
  });
});

describe("pol-aliases — the resolver", () => {
  const { aliases } = parsePolAliases(SAMPLE);

  it("resolves a POL id, case-insensitively", () => {
    expect(resolvePol(aliases, "POL-012")?.alias).to.deep.equal({ kind: "gov", gov: "GOV-FRM-012", also: [] });
    expect(resolvePol(aliases, "pol-013")?.pol).to.equal("POL-013");
  });

  it("resolves a dotted label through its base number (repo protect's old POL-040a.3)", () => {
    expect(polBase("POL-040a.3")).to.equal("POL-040a");
    expect(resolvePol(aliases, "POL-040a.3")?.pol).to.equal("POL-040a");
  });

  it("answers null for an unknown number and for anything that is not a POL id", () => {
    expect(resolvePol(aliases, UNKNOWN_POL)).to.equal(null);
    expect(resolvePol(aliases, "GOV-FRM-012")).to.equal(null);
    expect(polBase("POL-12")).to.equal(null);
  });

  it("lists the GOV ids an alias points at", () => {
    expect(aliasTargets(aliases.get("POL-044")!)).to.deep.equal(["GOV-FRM-044", "GOV-FRM-451"]);
    expect(aliasTargets(aliases.get("POL-013")!)).to.deep.equal(["GOV-FRM-012"]);
    expect(aliasTargets(aliases.get("POL-028")!)).to.deep.equal([]);
  });

  it("counts by kind", () => {
    expect(countAliases(aliases)).to.deep.equal({ mapped: 3, folded: 1, dropped: 1, org: 1 });
  });
});

describe("pol-aliases — the shipped file", () => {
  const text = readFileSync(path.join(CONTENT, POL_ALIASES_PATH), "utf8");
  const { aliases, errors } = parsePolAliases(text);
  const frm = new Set(parseRuleStore(readFileSync(path.join(CONTENT, RULE_STORE_PATHS.frameworkRules), "utf8")).map((r) => r.id));

  it("parses with no errors, and is big enough to mean something", () => {
    expect(errors).to.deep.equal([]);
    expect(aliases.size).to.be.greaterThan(250);
  });

  it("every GOV-FRM target is a row rules.yaml has — an alias never points at a rule that does not exist", () => {
    const missing = [...aliases].flatMap(([pol, a]) => aliasTargets(a).filter((g) => g.startsWith("GOV-FRM-") && !frm.has(g)).map((g) => `${pol} → ${g}`));
    expect(missing).to.deep.equal([]);
  });

  it("a fresh GOV-FRM number never aliases a POL number that meant something else (POL-444…453 were withdrawn)", () => {
    for (let n = 444; n <= 453; n++) expect(aliases.get(`POL-${n}`)?.kind, `POL-${n}`).to.equal("dropped");
  });

  it("every POL number cited anywhere in the repository resolves", function () {
    if (!existsSync(path.join(REPO, ".git"))) this.skip();
    const out = execFileSync("git", ["-C", REPO, "grep", "-ohE", "POL-[0-9]{3}[a-z]?"], { encoding: "utf8" });
    const cited = [...new Set(out.split("\n").filter(Boolean))];
    expect(cited.length).to.be.greaterThan(50);
    expect(cited.filter((p) => resolvePol(aliases, p) === null)).to.deep.equal([]);
  });
});

// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * THE SHIPPED POLICY-DOCUMENT FILES (F127, 2026-11-20): both parse and check clean, the framework's names the eight
 * seeded chapters under their titles, and the two merge into the document a reader sees.
 */
import { expect } from "chai";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { parsePolicyDocument, mergePolicyDocuments, POLICY_DOCUMENT_PATHS } from "../../src/rules/model/policy-document.js";
import { CHAPTERS } from "../../src/rules/model/rule-row.js";

const CONTENT = fileURLToPath(new URL("../../../../content/", import.meta.url));
const shipped = (owner: "framework" | "org") => parsePolicyDocument(fs.readFileSync(path.join(CONTENT, POLICY_DOCUMENT_PATHS[owner]), "utf8"), owner);

describe("policy-document.yaml — the shipped files (F127)", () => {
  it("the framework's and the organization's both check clean", () => {
    expect(shipped("framework").problems).to.deep.equal([]);
    expect(shipped("org").problems).to.deep.equal([]);
  });

  it("the framework's names chapters 1 to 8 under the seeded titles, in order", () => {
    expect(shipped("framework").doc.chapters.map((c) => [c.number, c.title])).to.deep.equal(Object.entries(CHAPTERS).map(([n, t]) => [Number(n), t]));
  });

  it("the organization's seed has a title page and nothing of the framework's", () => {
    const o = shipped("org").doc;
    expect(o.title_page?.title).to.be.a("string").and.not.equal("");
    expect(o.chapters).to.deep.equal([]);
  });
});

describe("parsePolicyDocument / mergePolicyDocuments", () => {
  it("refuses a framework file missing a chapter, renaming one, or adding a ninth", () => {
    const p = parsePolicyDocument("chapters:\n  - { number: 1, title: Purpose }\n  - { number: 9, title: Extra }\nglossary: []\n", "framework").problems.join("\n");
    expect(p).to.match(/chapter 1: the framework's title is "Purpose, scope and authority"/);
    expect(p).to.match(/chapter 9: the framework's chapters are 1 to 8/);
    expect(p).to.match(/chapter 2 \(Roles and responsibilities\) is missing/);
  });

  it("refuses a title page in the framework's file, an untitled added chapter, and a term defined twice", () => {
    expect(parsePolicyDocument("title_page: { title: x }\nchapters: []\n", "framework").problems.join()).to.match(/unknown key "title_page"/);
    expect(parsePolicyDocument("chapters:\n  - { number: 9, intro: x }\n", "org").problems.join()).to.match(/needs a title/);
    expect(parsePolicyDocument("glossary:\n  - { term: Agent, definition: a }\n  - { term: agent, definition: b }\n", "org").problems.join()).to.match(/defined twice/);
    expect(parsePolicyDocument("glossary:\n  - { term: Agent }\n", "org").problems.join()).to.match(/needs a term and a definition/);
  });

  it("merges: seeded chapters renamed by the org, its added chapter, both intros, the org's definition winning", () => {
    const fw = parsePolicyDocument("chapters:\n  - { number: 3, title: Development, intro: F3 }\nglossary:\n  - { term: Agent, definition: theirs }\n  - { term: Exception, definition: E }\n", "framework").doc;
    const org = parsePolicyDocument("title_page: { title: T }\nchapters:\n  - { number: 3, title: Engineering, intro: O3 }\n  - { number: 9, title: Vendors, intro: O9 }\nglossary:\n  - { term: agent, definition: ours }\n", "org").doc;
    const m = mergePolicyDocuments(fw, org);
    expect(m.title_page).to.deep.equal({ title: "T" });
    expect(m.chapters.map((c) => c.number)).to.deep.equal([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(m.chapters[2]).to.deep.equal({ number: 3, title: "Engineering", frameworkIntro: "F3", orgIntro: "O3" });
    expect(m.chapters[8]).to.deep.include({ title: "Vendors", orgIntro: "O9" });
    expect(m.glossary).to.deep.equal([{ term: "agent", definition: "ours", from: "org" }, { term: "Exception", definition: "E", from: "framework" }]);
  });
});

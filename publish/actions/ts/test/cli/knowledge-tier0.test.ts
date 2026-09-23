// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * `gov knowledge search|show|list` — tier 0 (Policy Owner, 2026-09-23).
 *
 * What these tests hold to: a search answers from the markdown that is already cloned, an edit is visible the
 * moment it is saved, and the reading verbs leave nothing behind — no index, no cache, no state.
 */
import { expect } from "chai";
import { search, termsOf, headingsOf, formatHits, formatList, hitsJson } from "../../src/knowledge-search.js";
import { collectDocs, loadDocs, resolveDoc } from "../../src/cli/knowledge-io.js";
import type { Fs } from "../../src/lifecycle/fs-io.js";

const DOCS = [
  { path: "policies/data-classification.md", text: "# Data classification\n\n## Restricted\nRestricted data must never be written to a log.\n" },
  { path: "knowledge/architecture/logging.md", text: "# Logging\n\nEvery client logs through svm-util-log.\n" },
  { path: "framework/policies/framework-policy.md", text: "# Framework policy\n\n## Data\nSee the org's data classification standard.\n" },
];

/** A filesystem over a plain map of path → contents; directories are implied by the paths. */
function mapFs(files: Record<string, string>): Fs & { writes: Record<string, string> } {
  const writes: Record<string, string> = {};
  const all = (): string[] => [...Object.keys(files), ...Object.keys(writes)];
  return {
    writes,
    pathExists: (p) => all().some((f) => f === p || f.startsWith(`${p}/`)),
    readFile: (f) => writes[f] ?? files[f] ?? null,
    writeFile: (f, c) => { writes[f] = c; },
    mkdirp: () => {},
    rm: () => {},
    readdir: (dir) => {
      const prefix = `${dir}/`;
      const names = new Set<string>();
      for (const f of all()) if (f.startsWith(prefix)) names.add(f.slice(prefix.length).split("/")[0]!);
      return [...names];
    },
  };
}

describe("knowledge search — ranking", () => {
  it("requires EVERY term — two words are not an either/or", () => {
    const hits = search(DOCS, "data classification");
    expect(hits.map((h) => h.path)).to.have.members(["policies/data-classification.md", "framework/policies/framework-policy.md"]);
    expect(hits.some((h) => h.path.includes("logging")), "logging.md has neither word").to.equal(false);
  });

  it("ranks the document that OWNS the subject above the one that mentions it", () => {
    const hits = search(DOCS, "data classification");
    expect(hits[0]!.path).to.equal("policies/data-classification.md");
  });

  it("says WHERE in the document the answer is", () => {
    const [hit] = search(DOCS, "restricted");
    expect(hit!.path).to.equal("policies/data-classification.md");
    expect(hit!.heading).to.equal("Restricted");
    expect(hit!.line).to.contain("never be written to a log");
    expect(hit!.lineNo).to.be.greaterThan(1);
  });

  it('keeps a "quoted phrase" together', () => {
    expect(termsOf('"data classification" restricted')).to.deep.equal(["data classification", "restricted"]);
    expect(search(DOCS, '"classification standard"').map((h) => h.path)).to.deep.equal(["framework/policies/framework-policy.md"]);
  });

  it("matches on the PATH too — a project is findable by its name", () => {
    const docs = [{ path: "projects/PRJ-9-billing/knowledge/todo.md", text: "# Todo\n\nnothing yet\n" }];
    expect(search(docs, "billing")[0]!.path).to.equal("projects/PRJ-9-billing/knowledge/todo.md");
  });

  it("an empty query matches nothing (it must not dump the repository)", () => {
    expect(search(DOCS, "   ")).to.deep.equal([]);
  });

  it("honours the limit", () => {
    expect(search(DOCS, "a", 1)).to.have.length(1);
  });

  it("finds every heading with its line", () => {
    expect(headingsOf(DOCS[0]!.text)).to.deep.equal([{ line: 1, heading: "Data classification" }, { line: 3, heading: "Restricted" }]);
  });
});

describe("knowledge search — what it prints", () => {
  it("a miss says so, and says what to try", () => {
    const out = formatHits([], "quantum").join("\n");
    expect(out).to.contain("nothing matches 'quantum'");
    expect(out, "a dead end must offer the next command").to.contain("gov knowledge list");
  });

  it("a hit names the file, the heading and how to open it", () => {
    const out = formatHits(search(DOCS, "restricted"), "restricted").join("\n");
    expect(out).to.contain("policies/data-classification.md");
    expect(out).to.contain("Restricted");
    expect(out).to.contain("gov knowledge show");
  });

  it("list groups by folder and counts", () => {
    const out = formatList(DOCS).join("\n");
    expect(out).to.contain("3 documents");
    expect(out).to.contain("policies/");
  });

  it("--json is data an agent can consume — path, heading, line, score", () => {
    const parsed = JSON.parse(hitsJson(search(DOCS, "restricted"), "restricted")) as { query: string; results: { path: string; lineNo: number }[] };
    expect(parsed.query).to.equal("restricted");
    expect(parsed.results[0]).to.include.keys("path", "heading", "line", "lineNo", "score");
  });
});

describe("knowledge index — collecting", () => {
  const files = {
    "/home/knowledge/a.md": "# A",
    "/home/policies/sub/b.md": "# B",
    "/home/framework/docs/c.markdown": "not indexed",
    "/home/projects/PRJ-1/knowledge/d.md": "# D",
    "/home/node_modules/pkg/readme.md": "# vendored",
    "/home/knowledge/.git/x.md": "# git internals",
    "/home/src/code.ts": "const x = 1;",
  };

  it("reads the four knowledge roots and nothing else", () => {
    const paths = collectDocs(mapFs(files), "/home").map((d) => d.path);
    expect(paths).to.have.members(["knowledge/a.md", "policies/sub/b.md", "projects/PRJ-1/knowledge/d.md"]);
  });

  it("never walks node_modules or dot-directories", () => {
    const paths = collectDocs(mapFs(files), "/home").map((d) => d.path);
    expect(paths.some((p) => p.includes("node_modules") || p.includes(".git"))).to.equal(false);
  });
});

describe("knowledge reading — it leaves NOTHING behind", () => {
  // The cached index was built, measured (31ms to read 681 files vs 19ms to read a 5.5MB cache) and removed.
  // This test is what keeps it removed: a reading verb that starts writing state has to justify itself here.
  it("search writes nothing — no index, no cache, no state", () => {
    const fs = mapFs({ "/home/knowledge/a.md": "# A\n\nalpha\n" });
    const docs = loadDocs(fs, "/home");
    expect(search(docs, "alpha")).to.have.length(1);
    expect(Object.keys(fs.writes), "a read must not write").to.deep.equal([]);
  });

  it("reads the files every time, so an edit is visible immediately", () => {
    const files = { "/home/knowledge/a.md": "# A\n\nalpha\n" };
    const fs = mapFs(files);
    expect(search(loadDocs(fs, "/home"), "omega")).to.have.length(0);
    files["/home/knowledge/a.md"] = "# A\n\nomega\n";
    expect(search(loadDocs(fs, "/home"), "omega"), "the draft the person just saved").to.have.length(1);
  });

  it("answers on a workspace with no knowledge at all", () => {
    expect(loadDocs(mapFs({}), "/home")).to.deep.equal([]);
  });
});

describe("knowledge show — resolving what was typed", () => {
  it("takes the full path search printed", () => {
    expect(resolveDoc(DOCS, "policies/data-classification.md").doc!.path).to.equal("policies/data-classification.md");
  });
  it("takes the file name alone", () => {
    expect(resolveDoc(DOCS, "framework-policy.md").doc!.path).to.equal("framework/policies/framework-policy.md");
  });
  it("offers the candidates when a name is ambiguous, rather than opening the wrong one", () => {
    const docs = [{ path: "a/todo.md", text: "" }, { path: "b/todo.md", text: "" }];
    const r = resolveDoc(docs, "todo.md");
    expect(r.doc).to.equal(undefined);
    expect(r.candidates).to.have.members(["a/todo.md", "b/todo.md"]);
  });
});

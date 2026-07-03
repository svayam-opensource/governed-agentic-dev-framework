// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
import { expect } from "chai";
import * as path from "node:path";
import { checkKnowledge } from "../../src/governance/knowledge.js";
import type { ValidateContext } from "../../src/governance/validate.js";
import type { Fs } from "../../src/lifecycle/fs-io.js";

function ctx(files: Record<string, string>, extra: string[] = []): ValidateContext {
  const existing = new Set<string>(extra);
  for (const k of Object.keys(files)) {
    existing.add(k);
    let d = path.dirname(k);
    while (d && d !== "." && d !== "/") {
      existing.add(d);
      d = path.dirname(d);
    }
  }
  const fs: Fs = {
    pathExists: (p) => existing.has(path.relative("/repo", p)),
    readFile: (p) => files[path.relative("/repo", p)] ?? null,
    mkdirp: () => {},
    writeFile: () => {},
    rm: () => {},
    readdir: () => [],
  };
  return { fs, repoRoot: "/repo", files: Object.keys(files) };
}

const FM = (over: Record<string, string> = {}): string => {
  const d = { domain: "policies", layer: "mandate", compliance: "C01", status: "current", owner: "rkant", ...over };
  return `---\n${Object.entries(d).map(([k, v]) => `${k}: ${v}`).join("\n")}\n---\n`;
};

describe("prj-work Phase 3 — checkKnowledge (port of check_knowledge.py)", () => {
  it("passes a well-formed tree (index links the doc; front-matter valid)", () => {
    const r = checkKnowledge(
      ctx({
        "knowledge/policies/README.md": `${FM()}\n[foo](foo.md)\n`,
        "knowledge/policies/foo.md": `${FM()}\n# Foo policy\n`,
      }),
    );
    expect(r).to.deep.equal({ name: "knowledge", ok: true, errors: [] });
  });

  it("flags missing + invalid front-matter", () => {
    const r = checkKnowledge(
      ctx({
        "knowledge/policies/README.md": `${FM()}\n[a](a.md)\n[b](b.md)\n`,
        "knowledge/policies/a.md": "no front-matter here\n",
        "knowledge/policies/b.md": `${FM({ domain: "bogus" })}\n`,
      }),
    );
    expect(r.errors.some((e) => /a\.md: missing front-matter/.test(e))).to.equal(true);
    expect(r.errors.some((e) => /b\.md: front-matter domain='bogus' invalid/.test(e))).to.equal(true);
  });

  it("flags an orphan, a wikilink, a broken link, and a binary diagram", () => {
    const r = checkKnowledge(
      ctx({
        "knowledge/policies/README.md": `${FM()}\n[real](real.md)\n`,
        "knowledge/policies/real.md": `${FM()}\nSee [[other]] and [gone](missing.md).\n![d](diagram.png)\n`,
        "knowledge/policies/orphan.md": `${FM()}\n# nobody links me\n`,
      }),
    );
    expect(r.errors.some((e) => /orphan\.md: orphan/.test(e))).to.equal(true);
    expect(r.errors.some((e) => /real\.md: \[\[wikilink\]\] found/.test(e))).to.equal(true);
    expect(r.errors.some((e) => /real\.md: broken link 'missing\.md'/.test(e))).to.equal(true);
    expect(r.errors.some((e) => /binary diagram embed 'diagram\.png'/.test(e))).to.equal(true);
  });

  it("enforces layer↔folder agreement in a layer folder", () => {
    const r = checkKnowledge(
      ctx({
        "knowledge/development/README.md": `${FM({ domain: "development" })}\n[m](mandates/m.md)\n`,
        "knowledge/development/mandates/m.md": `${FM({ domain: "development", layer: "pattern" })}\n`,
      }),
    );
    expect(r.errors.some((e) => /m\.md: layer 'pattern' disagrees with folder 'mandate'/.test(e))).to.equal(true);
  });

  it("enforces journey purity for paths/*.md", () => {
    const r = checkKnowledge(
      ctx({
        "knowledge/paths/README.md": `${FM({ domain: "navigation", layer: "path" })}\n[j](j.md)\n`,
        "knowledge/paths/j.md": `${FM({ domain: "navigation", layer: "path" })}\nStep 1.\n\`\`\`\ncode\n\`\`\`\n`,
      }),
    );
    expect(r.errors.some((e) => /j\.md: journey docs are links-only — code block found/.test(e))).to.equal(true);
    expect(r.errors.some((e) => /j\.md: journey doc has fewer than 3 links/.test(e))).to.equal(true);
  });

  it("exempts superseded redirect stubs from the orphan check", () => {
    const r = checkKnowledge(
      ctx({
        "knowledge/policies/README.md": `${FM()}\n# index, links nothing\n`,
        "knowledge/policies/old.md": `${FM({ status: "superseded" })}\nMoved.\n`,
      }),
    );
    expect(r.ok).to.equal(true); // old.md not linked, but superseded → exempt
  });

  it("is a no-op in a template source repo (framework/ present, no knowledge/)", () => {
    expect(checkKnowledge(ctx({ "docs/x.md": "x" }, ["framework"]))).to.deep.equal({ name: "knowledge", ok: true, errors: [] });
  });

  it("fails when knowledge/ is missing in a real workspace", () => {
    const r = checkKnowledge(ctx({ "docs/x.md": "x" }));
    expect(r).to.deep.equal({ name: "knowledge", ok: false, errors: ["knowledge/ directory missing"] });
  });
});

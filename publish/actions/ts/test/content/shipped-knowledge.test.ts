// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * Publish gate: the framework's OWN shipped knowledge (publish/content/knowledge)
 * must pass the knowledge validator every adopter runs — so `gov validate` /
 * `gov close` can never fail on content we ship. Runs in `npm test` (⇒ prepublishOnly).
 */
import { expect } from "chai";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { checkKnowledge } from "../../src/governance/knowledge.js";
import type { ValidateContext } from "../../src/governance/validate.js";
import type { Fs } from "../../src/lifecycle/fs-io.js";

/** Locate publish/content by walking up from this test file. */
function contentDir(): string {
  let d = fileURLToPath(new URL(".", import.meta.url));
  for (let i = 0; i < 8; i++) {
    const c = path.join(d, "publish", "content");
    if (fs.existsSync(path.join(c, "MANIFEST.yaml"))) return c;
    const parent = path.dirname(d);
    if (parent === d) break;
    d = parent;
  }
  throw new Error("could not locate publish/content");
}
function walk(root: string, rel = ""): string[] {
  const abs = path.join(root, rel);
  const out: string[] = [];
  for (const n of fs.existsSync(abs) ? fs.readdirSync(abs) : []) {
    const childRel = rel ? `${rel}/${n}` : n;
    if (fs.statSync(path.join(root, childRel)).isDirectory()) out.push(...walk(root, childRel));
    else if (n.endsWith(".md")) out.push(childRel);
  }
  return out;
}

/**
 * THE SHIPPED TREES, PRESENTED AS AN ORG'S knowledge/ (sandbox audit, PRJ-121, 2026-10-07).
 *
 * This test used to pass without checking anything. checkKnowledge validates only paths under `knowledge/`, and
 * returns early when the root has no `knowledge/` but has `framework/` — the framework SOURCE repo case. The
 * shipped doctrine lives in framework/ and policies/, so every file was filtered out and `ok` was vacuous.
 *
 * So the test mounts each shipped tree under a virtual `knowledge/` (knowledge/framework/…, knowledge/policies/…)
 * and maps reads back onto the real files. Relative links between the two trees resolve exactly as they do on
 * disk, because both move by the same one level.
 */
const SHIPPED_TREES = ["framework", "policies"] as const;

function mountedAsKnowledge(content: string): { ctx: ValidateContext; files: string[] } {
  const files = SHIPPED_TREES.flatMap((t) => walk(path.join(content, t)).map((f) => `knowledge/${t}/${f}`));
  const virtualRoot = path.join(content, "__mounted__");
  const real = (p: string): string => {
    const rel = path.relative(virtualRoot, p).replace(/\\/g, "/");
    if (rel === "knowledge") return path.join(content, "__knowledge_root__");
    if (rel.startsWith("knowledge/")) return path.join(content, rel.slice("knowledge/".length));
    return path.join(content, rel);
  };
  const mountedFs: Fs = {
    readFile: (p) => (fs.existsSync(real(p)) ? fs.readFileSync(real(p), "utf8") : null),
    pathExists: (p) => path.relative(virtualRoot, p).replace(/\\/g, "/") === "knowledge" || fs.existsSync(real(p)),
    mkdirp: () => {}, writeFile: () => {}, rm: () => {}, readdir: () => [],
  };
  return { ctx: { fs: mountedFs, repoRoot: virtualRoot, files }, files };
}

describe("gov-work — shipped knowledge passes its own validator (publish gate)", () => {
  it("publish/content/framework and publish/content/policies validate clean", () => {
    // framework/ + policies/, not knowledge/ (Decision 10 of 2026-09-14, split again 2026-09-23). Framework
    // doctrine moved out of knowledge/, which ships EMPTY and belongs to the adopter. Both shipped trees are
    // validated: the framework's own, and the STARTER an org will curate.
    const { ctx, files } = mountedAsKnowledge(contentDir());
    expect(files.length).to.be.greaterThan(15); // sanity: we actually scanned the tree
    // THE ONE RULE NOT APPLIED: orphans. §7's orphan check is how an ORG's knowledge/ stays navigable — every doc
    // reachable from an index README. The shipped trees have no index READMEs: they are reached through the
    // MANIFEST and the session protocol, which load them by path. Every other check applies in full.
    const errors = checkKnowledge(ctx).errors.filter((e) => !/: orphan — /.test(e));
    expect(errors, `shipped knowledge failed:\n  ${errors.join("\n  ")}`).to.deep.equal([]);
  });

  it("the mount is not vacuous: a defect planted in a shipped doc is reported", () => {
    const { ctx, files } = mountedAsKnowledge(contentDir());
    const victim = files.find((f) => f.startsWith("knowledge/framework/") && !f.endsWith("/README.md"))!;
    const planted: Fs = {
      ...ctx.fs,
      readFile: (p) => (p === path.join(ctx.repoRoot, victim) ? `${ctx.fs.readFile(p) ?? ""}\nSee [[nowhere]] and [x](./no-such-file.md).\n` : ctx.fs.readFile(p)),
    };
    const r = checkKnowledge({ ...ctx, fs: planted });
    expect(r.ok).to.equal(false);
    expect(r.errors.join("\n")).to.include(`${victim}: [[wikilink]] found`);
    expect(r.errors.join("\n")).to.include(`${victim}: broken link './no-such-file.md'`);
  });
});

describe("gov-work — seeded policies carry no front matter (Policy Owner, 2026-10-06)", () => {
  // A level belongs to each RULE, set by the propose interview — never to a document. So a seeded policy opens with
  // its human header (title, owner, status), not a YAML block claiming a level for the whole file.
  const policiesDir = path.join(contentDir(), "policies");
  const seeded = fs.readdirSync(policiesDir).filter((n) => n.endsWith(".md") && n !== "CHANGELOG.md");

  it("no seeded policies/*.md opens with a front-matter block", () => {
    expect(seeded.length).to.be.greaterThan(5);
    const withFm = seeded.filter((n) => fs.readFileSync(path.join(policiesDir, n), "utf8").startsWith("---"));
    expect(withFm, `front matter in: ${withFm.join(", ")}`).to.deep.equal([]);
  });

  it("each keeps its human header: a title, an owner line and a status line", () => {
    for (const n of seeded) {
      const head = fs.readFileSync(path.join(policiesDir, n), "utf8").split("\n").slice(0, 8).join("\n");
      expect(head, n).to.match(/^# /);
      expect(head, n).to.match(/^\*\*(Policy Owner|Owner):\*\*/m);
      expect(head, n).to.match(/^\*\*Status:\*\*/m);
    }
  });

  it("the knowledge standard's §4 says front matter is the org's choice, and lists values propose can extract", () => {
    const text = fs.readFileSync(path.join(policiesDir, "knowledge-organization-standard.md"), "utf8");
    const s4 = text.slice(text.indexOf("## 4."), text.indexOf("## 5."));
    expect(s4).to.match(/your (organization's )?choice/i);
    expect(s4).to.match(/gov rules propose/);
    for (const v of ["mandate", "procedure", "pattern", "use-case", "spec", "compliance", "path", "current", "draft", "superseded"]) {
      expect(s4, v).to.include(`\`${v}\``);
    }
  });
});

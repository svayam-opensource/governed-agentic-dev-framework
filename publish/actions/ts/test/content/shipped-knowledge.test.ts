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

describe("gov-work — shipped knowledge passes its own validator (publish gate)", () => {
  it("publish/content/framework validates clean", () => {
    const content = contentDir();
    // framework/ + policies/, not knowledge/ (Decision 10 of 2026-09-14, split again 2026-09-23). Framework
    // doctrine moved out of knowledge/, which ships EMPTY and belongs to the adopter — so validating
    // publish/content/knowledge would assert over nothing, which is how a publish gate quietly stops gating.
    // Both shipped trees are validated: the framework's own, and the STARTER an org will curate.
    const files = [
      ...walk(path.join(content, "framework")).map((f) => `framework/${f}`),
      ...walk(path.join(content, "policies")).map((f) => `policies/${f}`),
    ];
    const realFs: Fs = {
      readFile: (p) => (fs.existsSync(p) ? fs.readFileSync(p, "utf8") : null),
      pathExists: (p) => fs.existsSync(p),
      mkdirp: () => {}, writeFile: () => {}, rm: () => {}, readdir: () => [],
    };
    const ctx: ValidateContext = { fs: realFs, repoRoot: content, files };
    const r = checkKnowledge(ctx);
    expect(r.ok, `shipped knowledge failed:\n  ${r.errors.join("\n  ")}`).to.equal(true);
    expect(files.length).to.be.greaterThan(15); // sanity: we actually scanned the tree
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

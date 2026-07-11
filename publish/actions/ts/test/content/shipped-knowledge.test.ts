// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * Publish gate: the framework's OWN shipped knowledge (publish/content/knowledge)
 * must pass the knowledge validator every adopter runs — so `gov-work validate` /
 * `gov-work close` can never fail on content we ship. Runs in `npm test` (⇒ prepublishOnly).
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
  it("publish/content/knowledge validates clean", () => {
    const content = contentDir();
    const files = walk(path.join(content, "knowledge")).map((f) => `knowledge/${f}`);
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
